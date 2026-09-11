import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Octree } from "three/addons/math/Octree.js";
import { Capsule } from "three/addons/math/Capsule.js";
import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier3d-compat";

await RAPIER.init();

const container = document.getElementById("scene-container");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111f);
scene.fog = new THREE.Fog(0x07111f, 18, 65);

/* =========================================================
   CÁMARA
========================================================= */

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

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

container.appendChild(renderer.domElement);

/* =========================================================
   ILUMINACIÓN
========================================================= */

scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x182030, 1.8));

const sun = new THREE.DirectionalLight(0xffffff, 3);

sun.position.set(-5, 18, 6);

sun.castShadow = true;

sun.shadow.mapSize.set(2048, 2048);

scene.add(sun);

/* =========================================================
   VARIABLES GENERALES
========================================================= */

const timer = new THREE.Timer();

const worldOctree = new Octree();

/* =========================================================
   JUGADOR
========================================================= */

const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1, 0), 0.35);

const playerVelocity = new THREE.Vector3();

const playerDirection = new THREE.Vector3();

const keyStates = {};

let playerOnFloor = false;

/* =========================================================
   MUNDO FÍSICO RAPIER
========================================================= */

const gravity = {
  x: 0,
  y: -9.81,
  z: 0,
};

const physicsWorld = new RAPIER.World(gravity);

/* =========================================================
   OBJETOS DEL ESCENARIO
========================================================= */

const physicalObjects = [];

const lasers = [];

const collisionMeshes = [];

const occupiedSpots = [];

/* =========================================================
   RAYCASTERS
========================================================= */

const downRaycaster = new THREE.Raycaster();

const clearanceRaycaster = new THREE.Raycaster();

const downDirection = new THREE.Vector3(0, -1, 0);

/* =========================================================
   ZONA DONDE SE GENERARÁN LOS CUBOS
========================================================= */

const SPAWN_ZONE = {
  minX: -6,

  maxX: 6,

  minZ: -8,

  maxZ: -2.5,
};

/* =========================================================
   COLORES ALEATORIOS
========================================================= */

const cubeColors = [
  0x94a3b8,

  0x64748b,

  0x0ea5e9,

  0x22c55e,

  0xf59e0b,

  0xf97316,

  0xa78bfa,
];

/* =========================================================
   FUNCIONES AUXILIARES
========================================================= */

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomColor() {
  return cubeColors[Math.floor(Math.random() * cubeColors.length)];
}

/* =========================================================
   CREAR CAJA DINÁMICA
========================================================= */

function createDynamicBox(x, y, z, sx, sy, sz, mass = 4, color = 0x94a3b8) {
  /* -------------------------------------------------------
     OBJETO THREE.JS
  ------------------------------------------------------- */

  const geometry = new THREE.BoxGeometry(sx, sy, sz);

  const material = new THREE.MeshStandardMaterial({
    color,

    roughness: 0.68,

    metalness: 0.06,
  });

  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.set(x, y, z);

  mesh.castShadow = true;

  mesh.receiveShadow = true;

  scene.add(mesh);

  /* -------------------------------------------------------
     CUERPO FÍSICO RAPIER
  ------------------------------------------------------- */

  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()

    .setTranslation(x, y, z)

    /* Evita que atraviese paredes
         cuando se mueve rápidamente */
    .setCcdEnabled(true);

  const body = physicsWorld.createRigidBody(bodyDesc);

  /* -------------------------------------------------------
     COLLIDER
  ------------------------------------------------------- */

  const colliderDesc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)

    .setDensity(mass / Math.max(sx * sy * sz, 0.01))

    .setFriction(0.82)

    .setRestitution(0.08);

  physicsWorld.createCollider(colliderDesc, body);

  /* -------------------------------------------------------
     REGISTRAR OBJETO
  ------------------------------------------------------- */

  physicalObjects.push({
    mesh,

    body,

    radius: Math.max(sx, sz) / 2,
  });
}

/* =========================================================
   CREAR CUBO SOBRE EL PISO
========================================================= */

function createDynamicCube(x, groundY, z, size, mass, color = randomColor()) {
  /*
   * La coordenada Y de un Mesh corresponde
   * al centro del cubo.
   *
   * Por eso:
   *
   * Y = piso + tamaño / 2
   */

  const y = groundY + size / 2 + 0.015;

  createDynamicBox(
    x,

    y,

    z,

    size,

    size,

    size,

    mass,

    color,
  );
}

/* =========================================================
   CONVERTIR EL ESCENARIO A COLLIDERS RAPIER
========================================================= */

function createRapierScenarioColliders(model) {
  model.updateMatrixWorld(true);

  let createdColliders = 0;

  model.traverse((child) => {
    if (!child.isMesh || !child.geometry?.getAttribute("position")) {
      return;
    }

    const geometry = child.geometry;

    const position = geometry.getAttribute("position");

    const vertexCount = position.count;

    if (vertexCount < 3) {
      return;
    }

    /* ---------------------------------------------------
         VÉRTICES
      --------------------------------------------------- */

    const vertices = new Float32Array(vertexCount * 3);

    const vertex = new THREE.Vector3();

    for (let i = 0; i < vertexCount; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);

      vertices[i * 3] = vertex.x;

      vertices[i * 3 + 1] = vertex.y;

      vertices[i * 3 + 2] = vertex.z;
    }

    /* ---------------------------------------------------
         ÍNDICES
      --------------------------------------------------- */

    let indices;

    if (geometry.index) {
      indices = new Uint32Array(geometry.index.count);

      for (let i = 0; i < geometry.index.count; i++) {
        indices[i] = geometry.index.getX(i);
      }
    } else {
      const indexCount = Math.floor(vertexCount / 3) * 3;

      indices = new Uint32Array(indexCount);

      for (let i = 0; i < indexCount; i++) {
        indices[i] = i;
      }
    }

    if (indices.length < 3) {
      return;
    }

    /* ---------------------------------------------------
         TRIMESH RAPIER

         Esto hace que:
         - paredes
         - piso
         - rampas
         - obstáculos

         tengan colisión física.
      --------------------------------------------------- */

    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)

      .setFriction(0.86)

      .setRestitution(0.04);

    physicsWorld.createCollider(colliderDesc);

    createdColliders++;
  });

  return createdColliders;
}

/* =========================================================
   PISO DE RESPALDO
========================================================= */

function createFallbackGround() {
  const groundDesc = RAPIER.ColliderDesc.cuboid(30, 0.1, 30)

    .setTranslation(0, -0.1, 0)

    .setFriction(0.86);

  physicsWorld.createCollider(groundDesc);
}

/* =========================================================
   ENCONTRAR EL PISO EN X,Z
========================================================= */

function getGroundInfo(x, z) {
  const origin = new THREE.Vector3(x, 20, z);

  downRaycaster.set(origin, downDirection);

  downRaycaster.near = 0;

  downRaycaster.far = 45;

  const hits = downRaycaster.intersectObjects(collisionMeshes, false);

  for (const hit of hits) {
    if (!hit.face) {
      continue;
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);

    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();

    /*
     * Sólo aceptamos superficies
     * aproximadamente horizontales.
     */

    if (worldNormal.y > 0.82 && hit.point.y > -1.5 && hit.point.y < 1.5) {
      return {
        y: hit.point.y,

        normal: worldNormal,
      };
    }
  }

  return null;
}

/* =========================================================
   COMPROBAR QUE NO HAYA UNA PARED CERCA
========================================================= */

function hasHorizontalClearance(x, groundY, z, radius) {
  const origin = new THREE.Vector3(
    x,

    groundY + Math.max(0.35, radius * 0.85),

    z,
  );

  const directions = [
    new THREE.Vector3(1, 0, 0),

    new THREE.Vector3(-1, 0, 0),

    new THREE.Vector3(0, 0, 1),

    new THREE.Vector3(0, 0, -1),

    new THREE.Vector3(1, 0, 1).normalize(),

    new THREE.Vector3(1, 0, -1).normalize(),

    new THREE.Vector3(-1, 0, 1).normalize(),

    new THREE.Vector3(-1, 0, -1).normalize(),
  ];

  for (const direction of directions) {
    clearanceRaycaster.set(origin, direction);

    clearanceRaycaster.near = 0;

    clearanceRaycaster.far = radius + 0.35;

    const hit = clearanceRaycaster.intersectObjects(collisionMeshes, false)[0];

    if (hit && hit.distance < radius + 0.28) {
      return false;
    }
  }

  return true;
}

/* =========================================================
   EVITAR QUE LOS CUBOS APAREZCAN UNOS SOBRE OTROS
========================================================= */

function overlapsOccupiedSpot(x, z, radius) {
  return occupiedSpots.some((spot) => {
    const distance = Math.hypot(
      x - spot.x,

      z - spot.z,
    );

    return distance < radius + spot.radius;
  });
}

/* =========================================================
   BUSCAR POSICIÓN ALEATORIA VÁLIDA
========================================================= */

function findOpenSpawnSpot(radius, maxAttempts = 120) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = randomBetween(
      SPAWN_ZONE.minX,

      SPAWN_ZONE.maxX,
    );

    const z = randomBetween(
      SPAWN_ZONE.minZ,

      SPAWN_ZONE.maxZ,
    );

    /*
     * Evita que aparezcan
     * encima del jugador.
     */

    if (Math.hypot(x, z) < 2.5 + radius) {
      continue;
    }

    const ground = getGroundInfo(x, z);

    if (!ground) {
      continue;
    }

    if (
      overlapsOccupiedSpot(
        x,

        z,

        radius + 0.12,
      )
    ) {
      continue;
    }

    if (
      !hasHorizontalClearance(
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
   CREAR PIRÁMIDE
========================================================= */

function createPyramid() {
  const baseSize = 0.9;

  const gap = 0.04;

  const pitch = baseSize + gap;

  const pyramidRadius = 1.9;

  /*
   * La posición de la pirámide
   * también cambia en cada carga.
   */

  const spot = findOpenSpawnSpot(pyramidRadius, 200) ?? {
    x: -0.5,

    z: -5.5,

    groundY: getGroundInfo(-0.5, -5.5)?.y ?? 0,
  };

  occupiedSpots.push({
    x: spot.x,

    z: spot.z,

    radius: pyramidRadius + 0.45,
  });

  /*
   * PIRÁMIDE:
   *
   * Nivel 1:
   *
   * X X X
   * X X X
   * X X X
   *
   * Nivel 2:
   *
   * X X
   * X X
   *
   * Nivel 3:
   *
   * X
   */

  const levelSizes = [
    0.9,

    0.82,

    0.72,
  ];

  const levelCounts = [
    3,

    2,

    1,
  ];

  let levelBottomY = spot.groundY;

  for (let level = 0; level < levelCounts.length; level++) {
    const count = levelCounts[level];

    const size = levelSizes[level];

    const y = levelBottomY + size / 2 + 0.015;

    for (let row = 0; row < count; row++) {
      for (let column = 0; column < count; column++) {
        const x = spot.x + (column - (count - 1) / 2) * pitch;

        const z = spot.z + (row - (count - 1) / 2) * pitch;

        const mass = 1.8 + size * 1.6;

        createDynamicBox(
          x,

          y,

          z,

          size,

          size,

          size,

          mass,

          level === 0 ? 0xf59e0b : level === 1 ? 0xf97316 : 0xfacc15,
        );
      }
    }

    levelBottomY += size + gap;
  }
}

/* =========================================================
   CUBOS ALEATORIOS
========================================================= */

function createRandomCubes(amount = 9) {
  for (let i = 0; i < amount; i++) {
    /*
     * Cada carga cambia:
     *
     * - posición
     * - tamaño
     * - color
     * - masa
     */

    const size = randomBetween(0.5, 1.35);

    const radius = size * 0.78;

    const spot = findOpenSpawnSpot(radius);

    if (!spot) {
      console.warn(`No se encontró un punto libre para el cubo aleatorio ${i + 1}.`);

      continue;
    }

    occupiedSpots.push({
      x: spot.x,

      z: spot.z,

      radius: radius + 0.2,
    });

    const mass = 1.4 + size * size * size * 2.2;

    createDynamicCube(
      spot.x,

      spot.groundY,

      spot.z,

      size,

      mass,
    );
  }
}

/* =========================================================
   CREAR TODOS LOS OBJETOS
========================================================= */

function createSceneObjects() {
  createPyramid();

  createRandomCubes(9);
}

/* =========================================================
   CARGAR ESCENARIO GLB
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

      /*
       * Guardamos los meshes
       * para realizar raycasting.
       */

      collisionMeshes.push(child);
    });

    scene.add(model);

    model.updateMatrixWorld(true);

    /* -----------------------------------------------------
       COLLISIONES DEL JUGADOR
    ----------------------------------------------------- */

    worldOctree.fromGraphNode(model);

    /* -----------------------------------------------------
       COLLISIONES DE LOS CUBOS
    ----------------------------------------------------- */

    const staticColliderCount = createRapierScenarioColliders(model);

    if (staticColliderCount === 0) {
      console.warn("No se generaron colliders del escenario.");

      createFallbackGround();
    }

    /*
     * IMPORTANTE:
     *
     * Los cubos se crean después
     * de conocer la geometría
     * real del escenario.
     */

    createSceneObjects();
  },

  undefined,

  (error) => {
    console.error("Error al cargar el escenario:", error);

    createFallbackGround();
  },
);

/* =========================================================
   VECTOR HACIA ADELANTE
========================================================= */

function getForwardVector() {
  camera.getWorldDirection(playerDirection);

  playerDirection.y = 0;

  return playerDirection.normalize();
}

/* =========================================================
   VECTOR LATERAL
========================================================= */

function getSideVector() {
  camera.getWorldDirection(playerDirection);

  playerDirection.y = 0;

  playerDirection.normalize();

  playerDirection.cross(camera.up);

  return playerDirection;
}

/* =========================================================
   CONTROLES
========================================================= */

function controls(deltaTime) {
  const speed = playerOnFloor ? 18 : 7;

  if (keyStates.KeyW) {
    playerVelocity.add(getForwardVector().multiplyScalar(speed * deltaTime));
  }

  if (keyStates.KeyS) {
    playerVelocity.add(getForwardVector().multiplyScalar(-speed * deltaTime));
  }

  if (keyStates.KeyA) {
    playerVelocity.add(getSideVector().multiplyScalar(-speed * deltaTime));
  }

  if (keyStates.KeyD) {
    playerVelocity.add(getSideVector().multiplyScalar(speed * deltaTime));
  }

  if (playerOnFloor && keyStates.Space) {
    playerVelocity.y = 7;
  }
}

/* =========================================================
   COLISIONES DEL JUGADOR
========================================================= */

function playerCollisions() {
  const result = worldOctree.capsuleIntersect(playerCollider);

  playerOnFloor = false;

  if (result) {
    playerOnFloor = result.normal.y > 0;

    if (!playerOnFloor) {
      playerVelocity.addScaledVector(
        result.normal,

        -result.normal.dot(playerVelocity),
      );
    }

    playerCollider.translate(result.normal.multiplyScalar(result.depth));
  }
}

/* =========================================================
   EMPUJAR CUBOS CON EL JUGADOR
========================================================= */

function pushNearbyObjects() {
  const moving = new THREE.Vector3(
    playerVelocity.x,

    0,

    playerVelocity.z,
  );

  if (moving.lengthSq() < 0.04) {
    return;
  }

  for (const item of physicalObjects) {
    const p = item.body.translation();

    const dx = p.x - camera.position.x;

    const dz = p.z - camera.position.z;

    const distance = Math.hypot(dx, dz);

    const contactDistance = item.radius + 0.75;

    if (distance < contactDistance) {
      const force = 0.8 / Math.max(distance, 0.25);

      item.body.applyImpulse(
        {
          x: dx * force,

          y: 0.06,

          z: dz * force,
        },

        true,
      );
    }
  }
}

/* =========================================================
   ACTUALIZAR JUGADOR
========================================================= */

function updatePlayer(deltaTime) {
  let damping = Math.exp(-4 * deltaTime) - 1;

  if (!playerOnFloor) {
    playerVelocity.y -= 25 * deltaTime;

    damping *= 0.1;
  }

  playerVelocity.addScaledVector(playerVelocity, damping);

  playerCollider.translate(playerVelocity.clone().multiplyScalar(deltaTime));

  playerCollisions();

  camera.position.copy(playerCollider.end);

  pushNearbyObjects();

  /*
   * Recuperar al jugador
   * si cae fuera del escenario.
   */

  if (camera.position.y < -20) {
    playerCollider.start.set(0, 0.35, 0);

    playerCollider.end.set(0, 1, 0);

    playerVelocity.set(0, 0, 0);

    camera.position.copy(playerCollider.end);
  }
}

/* =========================================================
   DISPARAR LÁSER
========================================================= */

function shootLaser() {
  if (document.pointerLockElement !== renderer.domElement) {
    return;
  }

  const direction = new THREE.Vector3();

  camera.getWorldDirection(direction).normalize();

  /* -------------------------------------------------------
     GEOMETRÍA DEL LÁSER
  ------------------------------------------------------- */

  const geometry = new THREE.CylinderGeometry(
    0.035,

    0.035,

    0.9,

    10,
  );

  geometry.rotateX(Math.PI / 2);

  const material = new THREE.MeshStandardMaterial({
    color: 0x67e8f9,

    emissive: 0x22d3ee,

    emissiveIntensity: 5,
  });

  const mesh = new THREE.Mesh(geometry, material);

  mesh.position.copy(camera.position).addScaledVector(direction, 0.8);

  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),

    direction,
  );

  scene.add(mesh);

  lasers.push({
    mesh,

    direction,

    speed: 32,

    life: 1.7,
  });
}

/* =========================================================
   EFECTO DE IMPACTO
========================================================= */

function createImpact(position) {
  const flash = new THREE.PointLight(
    0x67e8f9,

    8,

    4,

    2,
  );

  flash.position.copy(position);

  scene.add(flash);

  setTimeout(() => {
    scene.remove(flash);
  }, 90);
}

/* =========================================================
   BUSCAR IMPACTO MÁS CERCANO
========================================================= */

function getNearestLaserHit(ray, dynamicMeshes) {
  const dynamicHit = ray.intersectObjects(dynamicMeshes, false)[0];

  const scenarioHit = ray.intersectObjects(collisionMeshes, false)[0];

  if (!dynamicHit) {
    return scenarioHit ?? null;
  }

  if (!scenarioHit) {
    return dynamicHit;
  }

  return dynamicHit.distance <= scenarioHit.distance ? dynamicHit : scenarioHit;
}

/* =========================================================
   ACTUALIZAR LÁSERES
========================================================= */

function updateLasers(deltaTime) {
  const dynamicMeshes = physicalObjects.map((item) => item.mesh);

  for (let i = lasers.length - 1; i >= 0; i--) {
    const laser = lasers[i];

    const distance = laser.speed * deltaTime;

    const ray = new THREE.Raycaster(
      laser.mesh.position,

      laser.direction,

      0,

      distance + 0.55,
    );

    const hit = getNearestLaserHit(
      ray,

      dynamicMeshes,
    );

    /* -----------------------------------------------------
       HUBO IMPACTO
    ----------------------------------------------------- */

    if (hit) {
      const item = physicalObjects.find((entry) => entry.mesh === hit.object);

      /* ---------------------------------------------------
         IMPACTAR UN CUBO
      --------------------------------------------------- */

      if (item) {
        const impulse = {
          x: laser.direction.x * 10.5,

          y: laser.direction.y * 10.5 + 1.1,

          z: laser.direction.z * 10.5,
        };

        /*
         * Aplicamos la fuerza exactamente
         * en donde pegó el láser.
         *
         * Esto genera torque y permite
         * que el cubo rote y caiga.
         */

        item.body.applyImpulseAtPoint(
          impulse,

          {
            x: hit.point.x,

            y: hit.point.y,

            z: hit.point.z,
          },

          true,
        );
      }

      createImpact(hit.point);

      scene.remove(laser.mesh);

      lasers.splice(i, 1);

      continue;
    }

    /* -----------------------------------------------------
       MOVER LÁSER
    ----------------------------------------------------- */

    laser.mesh.position.addScaledVector(
      laser.direction,

      distance,
    );

    laser.life -= deltaTime;

    /* -----------------------------------------------------
       ELIMINAR LÁSER
    ----------------------------------------------------- */

    if (laser.life <= 0) {
      scene.remove(laser.mesh);

      lasers.splice(i, 1);
    }
  }
}

/* =========================================================
   SINCRONIZAR RAPIER CON THREE.JS
========================================================= */

function syncPhysics() {
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

document.addEventListener("keydown", (event) => {
  keyStates[event.code] = true;
});

document.addEventListener("keyup", (event) => {
  keyStates[event.code] = false;
});

/* =========================================================
   POINTER LOCK
========================================================= */

renderer.domElement.addEventListener("click", () => {
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock();
  }
});

/* =========================================================
   CONTROL DE CÁMARA
========================================================= */

document.addEventListener("mousemove", (event) => {
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
});

/* =========================================================
   DISPARO
========================================================= */

document.addEventListener("mousedown", (event) => {
  if (event.button === 0) {
    shootLaser();
  }
});

/* =========================================================
   LOOP PRINCIPAL
========================================================= */

function animate() {
  timer.update();

  const delta = Math.min(0.05, timer.getDelta());

  /* -------------------------------------------------------
     JUGADOR
  ------------------------------------------------------- */

  controls(delta);

  updatePlayer(delta);

  /* -------------------------------------------------------
     FÍSICA
  ------------------------------------------------------- */

  physicsWorld.timestep = delta;

  physicsWorld.step();

  syncPhysics();

  /* -------------------------------------------------------
     LÁSERES
  ------------------------------------------------------- */

  updateLasers(delta);

  /* -------------------------------------------------------
     RENDER
  ------------------------------------------------------- */

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

/* =========================================================
   RESPONSIVE
========================================================= */

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,

    window.innerHeight,
  );
});
