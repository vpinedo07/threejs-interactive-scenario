import * as THREE from "three";

import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier3d-compat";

/* =========================================================
   INICIALIZAR RAPIER
========================================================= */

await RAPIER.init();

/* =========================================================
   ELEMENTOS HTML
========================================================= */

const container = document.getElementById("scene-container");

const laserPowerInput = document.getElementById("laser-power");

const laserPowerValue = document.getElementById("laser-power-value");

const objectCountInput = document.getElementById("object-count");

const objectCountValue = document.getElementById("object-count-value");

const regenerateButton = document.getElementById("regenerate-objects");

/* =========================================================
   CONFIGURACIÓN
========================================================= */

let laserPower = Number(laserPowerInput?.value ?? 12);

let desiredObjectCount = Number(objectCountInput?.value ?? 35);

let sceneReady = false;

/* =========================================================
   THREE.JS
========================================================= */

const scene = new THREE.Scene();

/*
 * Cielo nocturno.
 */
scene.background = new THREE.Color(0x01030a);

scene.fog = new THREE.Fog(0x01030a, 30, 100);

/* =========================================================
   CÁMARA
========================================================= */

const camera = new THREE.PerspectiveCamera(
  70,

  window.innerWidth / window.innerHeight,

  0.1,

  1000,
);

camera.rotation.order = "YXZ";

/* =========================================================
   RENDERER
========================================================= */

const renderer = new THREE.WebGLRenderer({
  antialias: true,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

renderer.setSize(window.innerWidth, window.innerHeight);

renderer.shadowMap.enabled = true;

renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.outputColorSpace = THREE.SRGBColorSpace;

container.appendChild(renderer.domElement);

/* =========================================================
   ILUMINACIÓN NOCTURNA
========================================================= */

const hemisphereLight = new THREE.HemisphereLight(
  0x395b91,

  0x02030a,

  0.75,
);

scene.add(hemisphereLight);

/*
 * Luz tipo luna.
 */
const moonLight = new THREE.DirectionalLight(
  0xbcd7ff,

  2.2,
);

moonLight.position.set(-12, 25, 8);

moonLight.castShadow = true;

moonLight.shadow.mapSize.set(2048, 2048);

moonLight.shadow.camera.left = -40;

moonLight.shadow.camera.right = 40;

moonLight.shadow.camera.top = 40;

moonLight.shadow.camera.bottom = -40;

scene.add(moonLight);

/* =========================================================
   ESTRELLAS
========================================================= */

function createStars() {
  const starCount = 1800;

  const positions = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    /*
     * Distribución en una gran esfera
     * alrededor del escenario.
     */

    const radius = THREE.MathUtils.randFloat(100, 180);

    const theta = Math.random() * Math.PI * 2;

    const phi = Math.acos(THREE.MathUtils.randFloat(-0.15, 1));

    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);

    positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)) + 10;

    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",

    new THREE.BufferAttribute(positions, 3),
  );

  const material = new THREE.PointsMaterial({
    color: 0xffffff,

    size: 0.18,

    sizeAttenuation: true,

    transparent: true,

    opacity: 0.9,

    fog: false,
  });

  const stars = new THREE.Points(geometry, material);

  scene.add(stars);
}

createStars();

/* =========================================================
   MUNDO FÍSICO
========================================================= */

const physicsWorld = new RAPIER.World({
  x: 0,

  y: -9.81,

  z: 0,
});

/* =========================================================
   JUGADOR RAPIER
========================================================= */

const PLAYER_RADIUS = 0.35;

const PLAYER_HALF_HEIGHT = 0.38;

const PLAYER_EYE_OFFSET = 0.48;

const PLAYER_SPEED = 5.5;

const PLAYER_JUMP_SPEED = 7;

const PLAYER_GRAVITY = 18;

/*
 * Jugador cinemático.
 */
const playerBody = physicsWorld.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased()

    .setTranslation(0, 1, 0),
);

/*
 * Collider tipo cápsula.
 */
const playerCollider = physicsWorld.createCollider(
  RAPIER.ColliderDesc.capsule(
    PLAYER_HALF_HEIGHT,

    PLAYER_RADIUS,
  )

    .setFriction(0.8),

  playerBody,
);

/*
 * Controlador de personaje Rapier.
 */
const characterController = physicsWorld.createCharacterController(0.02);

characterController.setApplyImpulsesToDynamicBodies(true);

characterController.setCharacterMass(75);

characterController.enableAutostep(
  0.3,

  0.2,

  false,
);

characterController.enableSnapToGround(0.25);

characterController.setMaxSlopeClimbAngle((45 * Math.PI) / 180);

/* =========================================================
   ESTADO DEL JUGADOR
========================================================= */

const keyStates = {};

let verticalVelocity = 0;

let playerGrounded = false;

let jumpRequested = false;

/* =========================================================
   OBJETOS
========================================================= */

const physicalObjects = [];

const lasers = [];

const collisionMeshes = [];

const occupiedSpots = [];

/* =========================================================
   LÍMITES DEL ESCENARIO
========================================================= */

const spawnBounds = {
  minX: -15,

  maxX: 15,

  minZ: -15,

  maxZ: 15,

  rayTop: 20,
};

/* =========================================================
   RAYCASTERS
========================================================= */

const downRaycaster = new THREE.Raycaster();

const wallRaycaster = new THREE.Raycaster();

const downDirection = new THREE.Vector3(0, -1, 0);

/* =========================================================
   COLORES
========================================================= */

const objectColors = [
  0x38bdf8,

  0x22c55e,

  0xf59e0b,

  0xef4444,

  0xa78bfa,

  0xec4899,

  0x14b8a6,

  0xf97316,

  0x94a3b8,
];

/* =========================================================
   UTILIDADES
========================================================= */

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomColor() {
  return objectColors[Math.floor(Math.random() * objectColors.length)];
}

/* =========================================================
   MATERIAL DE OBJETOS
========================================================= */

function createObjectMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,

    roughness: 0.55,

    metalness: 0.12,
  });
}

/* =========================================================
   REGISTRAR OBJETO FÍSICO
========================================================= */

function registerPhysicalObject(mesh, body, type, radius) {
  mesh.castShadow = true;

  mesh.receiveShadow = true;

  scene.add(mesh);

  physicalObjects.push({
    mesh,

    body,

    type,

    radius,
  });
}

/* =========================================================
   CUBO
========================================================= */

function createCube(x, groundY, z, size = randomBetween(0.55, 1.35), color = randomColor()) {
  const geometry = new THREE.BoxGeometry(size, size, size);

  const mesh = new THREE.Mesh(
    geometry,

    createObjectMaterial(color),
  );

  const y = groundY + size / 2 + 0.02;

  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()

      .setTranslation(x, y, z)

      .setCcdEnabled(true),
  );

  const collider = RAPIER.ColliderDesc.cuboid(
    size / 2,

    size / 2,

    size / 2,
  )

    .setDensity(2)

    .setFriction(0.75)

    .setRestitution(0.12);

  physicsWorld.createCollider(collider, body);

  mesh.position.set(x, y, z);

  registerPhysicalObject(
    mesh,

    body,

    "cube",

    size * 0.75,
  );
}

/* =========================================================
   ESFERA
========================================================= */

function createSphere(x, groundY, z) {
  const radius = randomBetween(0.35, 0.8);

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),

    createObjectMaterial(randomColor()),
  );

  const y = groundY + radius + 0.02;

  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()

      .setTranslation(x, y, z)

      .setCcdEnabled(true),
  );

  physicsWorld.createCollider(
    RAPIER.ColliderDesc.ball(radius)

      .setDensity(1.6)

      .setFriction(0.55)

      .setRestitution(0.35),

    body,
  );

  mesh.position.set(x, y, z);

  registerPhysicalObject(
    mesh,

    body,

    "sphere",

    radius,
  );
}

/* =========================================================
   CILINDRO
========================================================= */

function createCylinder(x, groundY, z) {
  const radius = randomBetween(0.35, 0.7);

  const height = randomBetween(0.7, 1.7);

  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(
      radius,

      radius,

      height,

      24,
    ),

    createObjectMaterial(randomColor()),
  );

  const y = groundY + height / 2 + 0.02;

  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()

      .setTranslation(x, y, z)

      .setCcdEnabled(true),
  );

  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cylinder(
      height / 2,

      radius,
    )

      .setDensity(1.8)

      .setFriction(0.7),

    body,
  );

  mesh.position.set(x, y, z);

  registerPhysicalObject(
    mesh,

    body,

    "cylinder",

    radius,
  );
}

/* =========================================================
   CONO
========================================================= */

function createCone(x, groundY, z) {
  const radius = randomBetween(0.4, 0.75);

  const height = randomBetween(0.9, 1.8);

  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(
      radius,

      height,

      24,
    ),

    createObjectMaterial(randomColor()),
  );

  const y = groundY + height / 2 + 0.02;

  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()

      .setTranslation(x, y, z)

      .setCcdEnabled(true),
  );

  physicsWorld.createCollider(
    RAPIER.ColliderDesc.cone(
      height / 2,

      radius,
    )

      .setDensity(1.5)

      .setFriction(0.75),

    body,
  );

  mesh.position.set(x, y, z);

  registerPhysicalObject(
    mesh,

    body,

    "cone",

    radius,
  );
}

/* =========================================================
   CÁPSULA
========================================================= */

function createCapsuleObject(x, groundY, z) {
  const radius = randomBetween(0.3, 0.5);

  const middleHeight = randomBetween(0.5, 1.2);

  /*
   * CapsuleGeometry ya forma parte
   * de Three.js.
   */
  const geometry = new THREE.CapsuleGeometry(
    radius,

    middleHeight,

    6,

    12,
  );

  const mesh = new THREE.Mesh(
    geometry,

    createObjectMaterial(randomColor()),
  );

  const halfHeight = middleHeight / 2;

  const y = groundY + halfHeight + radius + 0.02;

  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()

      .setTranslation(x, y, z)

      .setCcdEnabled(true),
  );

  physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(
      halfHeight,

      radius,
    )

      .setDensity(1.7)

      .setFriction(0.65),

    body,
  );

  mesh.position.set(x, y, z);

  registerPhysicalObject(
    mesh,

    body,

    "capsule",

    radius,
  );
}

/* =========================================================
   5 TIPOS DE FIGURA
========================================================= */

const objectFactories = [createCube, createSphere, createCylinder, createCone, createCapsuleObject];

/* =========================================================
   ESCENARIO THREE.JS -> RAPIER
========================================================= */

function createRapierScenarioColliders(model) {
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.getAttribute("position")) {
      return;
    }

    const geometry = child.geometry;

    const position = geometry.getAttribute("position");

    const vertices = new Float32Array(position.count * 3);

    const point = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
      point
        .fromBufferAttribute(position, i)

        .applyMatrix4(child.matrixWorld);

      vertices[i * 3] = point.x;

      vertices[i * 3 + 1] = point.y;

      vertices[i * 3 + 2] = point.z;
    }

    let indices;

    if (geometry.index) {
      indices = new Uint32Array(geometry.index.count);

      for (let i = 0; i < geometry.index.count; i++) {
        indices[i] = geometry.index.getX(i);
      }
    } else {
      const count = Math.floor(position.count / 3) * 3;

      indices = new Uint32Array(count);

      for (let i = 0; i < count; i++) {
        indices[i] = i;
      }
    }

    if (indices.length < 3) {
      return;
    }

    const collider = RAPIER.ColliderDesc.trimesh(
      vertices,

      indices,
    )

      .setFriction(0.85)

      .setRestitution(0.03);

    physicsWorld.createCollider(collider);
  });
}

/* =========================================================
   DETECTAR SUELO
========================================================= */

function getGroundInfo(x, z) {
  if (collisionMeshes.length === 0) {
    return {
      y: 0,
    };
  }

  const origin = new THREE.Vector3(
    x,

    spawnBounds.rayTop,

    z,
  );

  downRaycaster.set(
    origin,

    downDirection,
  );

  downRaycaster.far = 200;

  const hits = downRaycaster.intersectObjects(
    collisionMeshes,

    false,
  );

  for (const hit of hits) {
    if (!hit.face) {
      continue;
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);

    const normal = hit.face.normal
      .clone()

      .applyMatrix3(normalMatrix)

      .normalize();

    /*
     * Sólo superficies razonablemente
     * horizontales.
     */
    if (normal.y > 0.75) {
      return {
        y: hit.point.y,

        normal,
      };
    }
  }

  return null;
}

/* =========================================================
   DETECTAR PAREDES AL GENERAR
========================================================= */

function hasClearance(x, y, z, radius) {
  const origin = new THREE.Vector3(
    x,

    y + 0.5,

    z,
  );

  const directions = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];

  for (const direction of directions) {
    wallRaycaster.set(
      origin,

      direction,
    );

    wallRaycaster.far = radius + 0.35;

    const hit = wallRaycaster.intersectObjects(
      collisionMeshes,

      false,
    )[0];

    if (hit && hit.distance < radius + 0.3) {
      return false;
    }
  }

  return true;
}

/* =========================================================
   EVITAR SUPERPOSICIÓN AL GENERAR
========================================================= */

function spotOccupied(x, z, radius) {
  return occupiedSpots.some((spot) => {
    const distance = Math.hypot(
      x - spot.x,

      z - spot.z,
    );

    return distance < radius + spot.radius;
  });
}

/* =========================================================
   BUSCAR POSICIÓN ALEATORIA
   EN TODO EL ESCENARIO
========================================================= */

function findSpawnSpot(radius = 0.7, attempts = 180) {
  const playerPosition = playerBody.translation();

  for (let attempt = 0; attempt < attempts; attempt++) {
    const x = randomBetween(
      spawnBounds.minX,

      spawnBounds.maxX,
    );

    const z = randomBetween(
      spawnBounds.minZ,

      spawnBounds.maxZ,
    );

    /*
     * No generar encima del jugador.
     */
    if (
      Math.hypot(
        x - playerPosition.x,

        z - playerPosition.z,
      ) < 2.5
    ) {
      continue;
    }

    const ground = getGroundInfo(x, z);

    if (!ground) {
      continue;
    }

    if (
      spotOccupied(
        x,

        z,

        radius + 0.15,
      )
    ) {
      continue;
    }

    if (
      !hasClearance(
        x,

        ground.y,

        z,

        radius,
      )
    ) {
      continue;
    }

    return {
      x,

      z,

      groundY: ground.y,
    };
  }

  return null;
}

/* =========================================================
   PIRÁMIDE
========================================================= */

const PYRAMID_OBJECTS = 14;

function createPyramid() {
  const pyramidRadius = 2;

  const spot = findSpawnSpot(
    pyramidRadius,

    300,
  );

  if (!spot) {
    console.warn("No se encontró espacio para la pirámide.");

    return 0;
  }

  occupiedSpots.push({
    x: spot.x,

    z: spot.z,

    radius: pyramidRadius,
  });

  const levels = [
    {
      count: 3,
      size: 0.82,
    },

    {
      count: 2,
      size: 0.72,
    },

    {
      count: 1,
      size: 0.64,
    },
  ];

  let baseY = spot.groundY;

  let created = 0;

  for (const level of levels) {
    const pitch = 0.9;

    const centerY = baseY + level.size / 2 + 0.02;

    for (let row = 0; row < level.count; row++) {
      for (let column = 0; column < level.count; column++) {
        const x = spot.x + (column - (level.count - 1) / 2) * pitch;

        const z = spot.z + (row - (level.count - 1) / 2) * pitch;

        /*
         * Construcción manual del cubo
         * para conservar la altura
         * correcta de la pila.
         */

        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(
            level.size,

            level.size,

            level.size,
          ),

          createObjectMaterial(level.count === 3 ? 0xf59e0b : level.count === 2 ? 0xf97316 : 0xfacc15),
        );

        const body = physicsWorld.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic()

            .setTranslation(
              x,

              centerY,

              z,
            )

            .setCcdEnabled(true),
        );

        physicsWorld.createCollider(
          RAPIER.ColliderDesc.cuboid(
            level.size / 2,

            level.size / 2,

            level.size / 2,
          )

            .setDensity(1.5)

            .setFriction(0.8),

          body,
        );

        mesh.position.set(
          x,

          centerY,

          z,
        );

        registerPhysicalObject(
          mesh,

          body,

          "pyramid-cube",

          level.size * 0.75,
        );

        created++;
      }
    }

    baseY += level.size + 0.04;
  }

  return created;
}

/* =========================================================
   FIGURAS ALEATORIAS
========================================================= */

function createRandomObjects(amount) {
  for (let i = 0; i < amount; i++) {
    /*
     * Tamaño aproximado utilizado
     * para buscar espacio.
     */
    const radius = randomBetween(0.5, 0.9);

    const spot = findSpawnSpot(radius);

    if (!spot) {
      console.warn("No fue posible encontrar más posiciones libres.");

      break;
    }

    occupiedSpots.push({
      x: spot.x,

      z: spot.z,

      radius: radius + 0.1,
    });

    /*
     * Elegir aleatoriamente
     * una de las cinco figuras.
     */

    const factory = objectFactories[Math.floor(Math.random() * objectFactories.length)];

    factory(
      spot.x,

      spot.groundY,

      spot.z,
    );
  }
}

/* =========================================================
   BORRAR OBJETOS ACTUALES
========================================================= */

function clearPhysicalObjects() {
  for (const item of physicalObjects) {
    scene.remove(item.mesh);

    item.mesh.geometry?.dispose();

    if (Array.isArray(item.mesh.material)) {
      item.mesh.material.forEach((material) => material.dispose());
    } else {
      item.mesh.material?.dispose();
    }

    physicsWorld.removeRigidBody(item.body);
  }

  physicalObjects.length = 0;

  occupiedSpots.length = 0;
}

/* =========================================================
   GENERAR TODOS LOS OBJETOS
========================================================= */

function regeneratePhysicalObjects() {
  if (!sceneReady) {
    return;
  }

  clearPhysicalObjects();

  /*
   * Pirámide de 14 cubos.
   */
  const pyramidCreated = createPyramid();

  /*
   * El control representa
   * el número TOTAL de objetos.
   */

  const randomAmount = Math.max(
    0,

    desiredObjectCount - pyramidCreated,
  );

  createRandomObjects(randomAmount);
}

/* =========================================================
   CARGAR ESCENARIO
========================================================= */

const loader = new GLTFLoader();

loader.load(
  "./assets/models/collision-world.glb",

  (gltf) => {
    const model = gltf.scene;

    model.traverse((child) => {
      if (!child.isMesh) {
        return;
      }

      child.castShadow = true;

      child.receiveShadow = true;

      if (child.material?.map) {
        child.material.map.anisotropy = 4;
      }

      collisionMeshes.push(child);
    });

    scene.add(model);

    model.updateMatrixWorld(true);

    /*
     * Determinar automáticamente
     * el tamaño del escenario.
     */

    const bounds = new THREE.Box3().setFromObject(model);

    const margin = 1;

    spawnBounds.minX = bounds.min.x + margin;

    spawnBounds.maxX = bounds.max.x - margin;

    spawnBounds.minZ = bounds.min.z + margin;

    spawnBounds.maxZ = bounds.max.z - margin;

    spawnBounds.rayTop = bounds.max.y + 20;

    /*
     * Crear colisiones estáticas
     * Rapier para piso, paredes,
     * rampas y obstáculos.
     */

    createRapierScenarioColliders(model);

    sceneReady = true;

    /*
     * Generación inicial.
     */

    regeneratePhysicalObjects();
  },

  undefined,

  (error) => {
    console.error(
      "Error cargando collision-world.glb:",

      error,
    );
  },
);

/* =========================================================
   DIRECCIONES DE MOVIMIENTO
========================================================= */

const forward = new THREE.Vector3();

const right = new THREE.Vector3();

const movementDirection = new THREE.Vector3();

function getMovementDirection() {
  movementDirection.set(0, 0, 0);

  camera.getWorldDirection(forward);

  forward.y = 0;

  forward.normalize();

  right
    .copy(forward)

    .cross(camera.up)

    .normalize();

  if (keyStates.KeyW) {
    movementDirection.add(forward);
  }

  if (keyStates.KeyS) {
    movementDirection.addScaledVector(forward, -1);
  }

  if (keyStates.KeyD) {
    movementDirection.add(right);
  }

  if (keyStates.KeyA) {
    movementDirection.addScaledVector(right, -1);
  }

  if (movementDirection.lengthSq() > 0) {
    movementDirection.normalize();
  }

  return movementDirection;
}

/* =========================================================
   ACTUALIZAR JUGADOR
========================================================= */

function updatePlayer(delta) {
  if (!sceneReady) {
    return;
  }

  /*
   * Salto.
   */

  if (playerGrounded && jumpRequested) {
    verticalVelocity = PLAYER_JUMP_SPEED;

    playerGrounded = false;
  }

  jumpRequested = false;

  /*
   * Gravedad.
   */

  verticalVelocity -= PLAYER_GRAVITY * delta;

  /*
   * Movimiento horizontal.
   */

  const direction = getMovementDirection();

  const desiredMovement = {
    x: direction.x * PLAYER_SPEED * delta,

    y: verticalVelocity * delta,

    z: direction.z * PLAYER_SPEED * delta,
  };

  /*
   * Rapier calcula cuánto puede
   * moverse el jugador sin atravesar:
   *
   * - paredes
   * - objetos
   * - cilindros
   * - cubos
   * - esferas
   * - etc.
   */

  characterController.computeColliderMovement(
    playerCollider,

    desiredMovement,
  );

  const corrected = characterController.computedMovement();

  playerGrounded = characterController.computedGrounded();

  if (playerGrounded && verticalVelocity < 0) {
    verticalVelocity = 0;
  }

  const current = playerBody.translation();

  playerBody.setNextKinematicTranslation({
    x: current.x + corrected.x,

    y: current.y + corrected.y,

    z: current.z + corrected.z,
  });
}

/* =========================================================
   ACTUALIZAR CÁMARA
========================================================= */

function updateCameraPosition() {
  const position = playerBody.translation();

  camera.position.set(
    position.x,

    position.y + PLAYER_EYE_OFFSET,

    position.z,
  );
}

/* =========================================================
   DISPARAR LÁSER
========================================================= */

function shootLaser() {
  if (document.pointerLockElement !== renderer.domElement) {
    return;
  }

  const direction = new THREE.Vector3();

  camera
    .getWorldDirection(direction)

    .normalize();

  const geometry = new THREE.CylinderGeometry(
    0.035,

    0.035,

    1.1,

    10,
  );

  geometry.rotateX(Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: 0x6ee7ff,

    emissive: 0x22d3ee,

    emissiveIntensity: 8,
  });

  const mesh = new THREE.Mesh(
    geometry,

    material,
  );

  mesh.position
    .copy(camera.position)

    .addScaledVector(direction, 0.8);

  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),

    direction,
  );

  scene.add(mesh);

  lasers.push({
    mesh,

    direction,

    speed: 40,

    life: 2,

    /*
     * Guardamos la potencia
     * seleccionada al disparar.
     */

    power: laserPower,
  });
}

/* =========================================================
   EFECTO DE IMPACTO
========================================================= */

function createImpact(position, power) {
  const flash = new THREE.PointLight(
    0x67e8f9,

    Math.min(power, 25),

    5,

    2,
  );

  flash.position.copy(position);

  scene.add(flash);

  setTimeout(
    () => {
      scene.remove(flash);
    },

    100,
  );
}

/* =========================================================
   ACTUALIZAR LÁSERES
========================================================= */

function updateLasers(delta) {
  const objectMeshes = physicalObjects.map((item) => item.mesh);

  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];

    const distance = laser.speed * delta;

    const raycaster = new THREE.Raycaster(
      laser.mesh.position,

      laser.direction,

      0,

      distance + 0.6,
    );

    /*
     * Impactos contra objetos.
     */

    const objectHit = raycaster.intersectObjects(
      objectMeshes,

      false,
    )[0];

    /*
     * Impactos contra paredes.
     */

    const worldHit = raycaster.intersectObjects(
      collisionMeshes,

      false,
    )[0];

    let hit = null;

    if (objectHit && worldHit) {
      hit = objectHit.distance < worldHit.distance ? objectHit : worldHit;
    } else {
      hit = objectHit ?? worldHit ?? null;
    }

    if (hit) {
      const item = physicalObjects.find((object) => object.mesh === hit.object);

      /*
       * Golpe sobre objeto físico.
       */

      if (item) {
        const power = laser.power;

        /*
         * La potencia seleccionada
         * controla directamente
         * el impulso.
         */

        item.body.applyImpulseAtPoint(
          {
            x: laser.direction.x * power,

            y: laser.direction.y * power + power * 0.08,

            z: laser.direction.z * power,
          },

          {
            x: hit.point.x,

            y: hit.point.y,

            z: hit.point.z,
          },

          true,
        );
      }

      createImpact(
        hit.point,

        laser.power,
      );

      scene.remove(laser.mesh);

      laser.mesh.geometry.dispose();

      laser.mesh.material.dispose();

      lasers.splice(i, 1);

      continue;
    }

    /*
     * Continuar movimiento.
     */

    laser.mesh.position.addScaledVector(
      laser.direction,

      distance,
    );

    laser.life -= delta;

    if (laser.life <= 0) {
      scene.remove(laser.mesh);

      laser.mesh.geometry.dispose();

      laser.mesh.material.dispose();

      lasers.splice(i, 1);
    }
  }
}

/* =========================================================
   SINCRONIZAR RAPIER -> THREE
========================================================= */

function syncPhysicalObjects() {
  for (const item of physicalObjects) {
    const position = item.body.translation();

    const rotation = item.body.rotation();

    item.mesh.position.set(
      position.x,

      position.y,

      position.z,
    );

    item.mesh.quaternion.set(
      rotation.x,

      rotation.y,

      rotation.z,

      rotation.w,
    );
  }
}

/* =========================================================
   TECLADO
========================================================= */

document.addEventListener(
  "keydown",

  (event) => {
    keyStates[event.code] = true;

    if (event.code === "Space" && !event.repeat) {
      jumpRequested = true;
    }
  },
);

document.addEventListener(
  "keyup",

  (event) => {
    keyStates[event.code] = false;
  },
);

/* =========================================================
   POINTER LOCK
========================================================= */

renderer.domElement.addEventListener(
  "click",

  () => {
    if (document.pointerLockElement !== renderer.domElement) {
      renderer.domElement.requestPointerLock();
    }
  },
);

/* =========================================================
   MOUSE / CÁMARA
========================================================= */

document.addEventListener(
  "mousemove",

  (event) => {
    if (document.pointerLockElement !== renderer.domElement) {
      return;
    }

    camera.rotation.y -= event.movementX / 500;

    camera.rotation.x -= event.movementY / 500;

    camera.rotation.x = THREE.MathUtils.clamp(
      camera.rotation.x,

      -Math.PI / 2,

      Math.PI / 2,
    );
  },
);

/* =========================================================
   DISPARO
========================================================= */

document.addEventListener(
  "mousedown",

  (event) => {
    if (event.button === 0) {
      shootLaser();
    }
  },
);

/* =========================================================
   CONTROL POTENCIA DEL LÁSER
========================================================= */

laserPowerInput?.addEventListener(
  "input",

  (event) => {
    laserPower = Number(event.target.value);

    laserPowerValue.textContent = laserPower;
  },
);

/* =========================================================
   CONTROL CANTIDAD DE OBJETOS
========================================================= */

objectCountInput?.addEventListener(
  "input",

  (event) => {
    desiredObjectCount = Number(event.target.value);

    objectCountValue.textContent = desiredObjectCount;
  },
);

/* =========================================================
   REGENERAR OBJETOS
========================================================= */

regenerateButton?.addEventListener(
  "click",

  (event) => {
    event.stopPropagation();

    regeneratePhysicalObjects();
  },
);

/* =========================================================
   TIMER
========================================================= */

const timer = new THREE.Timer();

/* =========================================================
   LOOP PRINCIPAL
========================================================= */

function animate() {
  timer.update();

  const delta = Math.min(
    0.05,

    timer.getDelta(),
  );

  /*
   * 1. Calcular movimiento
   *    del jugador.
   */

  updatePlayer(delta);

  /*
   * 2. Simulación Rapier.
   */

  physicsWorld.timestep = delta;

  physicsWorld.step();

  /*
   * 3. Sincronizar objetos.
   */

  syncPhysicalObjects();

  /*
   * 4. Cámara.
   */

  updateCameraPosition();

  /*
   * 5. Láser.
   */

  updateLasers(delta);

  /*
   * 6. Render.
   */

  renderer.render(
    scene,

    camera,
  );
}

renderer.setAnimationLoop(animate);

/* =========================================================
   RESPONSIVE
========================================================= */

window.addEventListener(
  "resize",

  () => {
    camera.aspect = window.innerWidth / window.innerHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
      window.innerWidth,

      window.innerHeight,
    );
  },
);
