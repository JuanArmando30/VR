import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const clock = new THREE.Clock();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88ccee);
scene.fog = new THREE.Fog(0x88ccee, 0, 50);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';

// Cambiar orientación inicial
//camera.lookAt(new THREE.Vector3(camera.position.x - 1, camera.position.y, camera.position.z));

const fillLight1 = new THREE.HemisphereLight(0x8dc1de, 0x00668d, 1.5);
fillLight1.position.set(2, 1, 1);
scene.add(fillLight1);

const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
directionalLight.position.set(- 5, 25, - 1);
directionalLight.castShadow = true;
directionalLight.shadow.camera.near = 0.01;
directionalLight.shadow.camera.far = 500;
directionalLight.shadow.camera.right = 30;
directionalLight.shadow.camera.left = - 30;
directionalLight.shadow.camera.top = 30;
directionalLight.shadow.camera.bottom = - 30;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.radius = 4;
directionalLight.shadow.bias = - 0.00006;
scene.add(directionalLight);

const container = document.getElementById('container');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// ACTIVAR VR
renderer.xr.enabled = true;
document.body.appendChild(VRButton.createButton(renderer));

const controller = renderer.xr.getController(0); // controlador derecho (0 o 1 según el caso)
controller.userData.selectPressed = false;
scene.add(controller);

const geometryLine = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1)
]);
const laser = new THREE.Line(
    geometryLine,
    new THREE.LineBasicMaterial({ color: 0xffff00 })
);
laser.name = 'laser';
laser.scale.z = 4;
controller.add(laser);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const GRAVITY = 50;

let GRAVITY_SUPLEMENTO = 0;  // Por defecto no cambia la gravedad
let SPEED_MULTIPLIER = 1.0;  // Por defecto velocidad normal

const NUM_SPHERES = 100;
const SPHERE_RADIUS = 0.2;

const STEPS_PER_FRAME = 5;

const sphereGeometry = new THREE.IcosahedronGeometry(SPHERE_RADIUS, 5);
const sphereMaterial = new THREE.MeshLambertMaterial({ color: 0xdede8d });

const spheres = [];
let sphereIdx = 0;

let vrDistanciaSprite;
let vrDistanciaText = '';

let vrMensajeSprite;
let vrMensajeText = '';

let disparando = false;

let vrSuperpoderSprite;
let vrMensajeSuperpoderSprite;

let vrPantallaDerrotaSprite;
let vrPantallaVictoriaSprite;

let mensajeBombaDesactivadaActivo = false;

for (let i = 0; i < NUM_SPHERES; i++) {

    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.castShadow = true;
    sphere.receiveShadow = true;

    scene.add(sphere);

    spheres.push({
        mesh: sphere,
        collider: new THREE.Sphere(new THREE.Vector3(0, - 100, 0), SPHERE_RADIUS),
        velocity: new THREE.Vector3()
    });

}

function processControllerInput(deltaTime) {
    const session = renderer.xr.getSession();
    if (!session) return;

    for (const source of session.inputSources) {

        if (!source.gamepad) continue;

        const axes = source.gamepad.axes;

        // Intenta con axes[0]/[1]
        let x = axes[0] || 0;
        let y = axes[1] || 0;

        // Si están en cero, intenta con [2]/[3]
        if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01 && axes.length >= 4) {
            x = axes[2] || 0;
            y = axes[3] || 0;
        }

        // Solo mover si hay movimiento real
        if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) {
            const speed = deltaTime * 15 * SPEED_MULTIPLIER;

            const forward = getForwardVector().multiplyScalar(-y * speed);
            const side = getSideVector().multiplyScalar(x * speed);

            playerVelocity.add(forward).add(side);
        }

        if (source.handedness === 'right') {
            const buttons = source.gamepad.buttons;
            const buttonGB = buttons[1]; // gatillo bajo normalmente es el botón 0
            const buttonA = buttons[4];
            const buttonB = buttons[5];
            const buttonGP = buttons[0];
            controller.userData.selectPressed = buttons[0]?.pressed || false;

            // Detectar si se presionó "GB"
            if (buttonGB?.pressed && playerOnFloor) {
                playerVelocity.y = 15; // Fuerza del salto
            }

            // Desactivar bomba si hay bomba interactuable y no está desactivada
            if (buttonA?.pressed && bombaInteractuable && !bombaDesactivada.has(bombaInteractuable) && !desactivando) {
                desactivarBomba(bombaInteractuable);
            }
            if (buttonB?.pressed) {
                toggleMenuVR();
            }

            if (buttonB?.pressed && !menuVRGroup.visible) {
                toggleMenuVR();
            }

            const triggerPressed = buttons[0]?.pressed || false;

            if (buttonGB?.pressed || triggerPressed && !disparando) {
                throwBall(); // 👉 dispara al presionar el gatillo
                disparando = true;
            }

            if (!triggerPressed) {
                disparando = false;
            }
        }
    }
}

const worldOctree = new Octree();

const playerStart = new THREE.Vector3(45, 0, 0); // misma posición que el playerRig
const playerCollider = new Capsule(
    playerStart.clone(),
    playerStart.clone().add(new THREE.Vector3(0, 0.65, 0)),
    0.35
);

// Crear elemento HTML para el contador (centrado arriba)
/*
const contadorElement = document.createElement('div');
contadorElement.style.position = 'absolute';
contadorElement.style.top = '20px';
contadorElement.style.left = '50%';
contadorElement.style.transform = 'translateX(-50%)';
contadorElement.style.padding = '10px 20px';
contadorElement.style.backgroundColor = 'rgba(0,0,0,0.5)';
contadorElement.style.color = 'white';
contadorElement.style.fontFamily = 'Arial';
contadorElement.style.fontSize = '20px';
contadorElement.style.borderRadius = '8px';
contadorElement.style.textAlign = 'center';
document.body.appendChild(contadorElement);
*/
/*
const superpoderIndicator = document.createElement('div');
superpoderIndicator.style.position = 'absolute';
superpoderIndicator.style.top = '75px'; // Debajo del cronómetro (ajusta si quieres)
superpoderIndicator.style.left = '50%';
superpoderIndicator.style.transform = 'translateX(-50%)';
superpoderIndicator.style.padding = '8px 16px';
superpoderIndicator.style.backgroundColor = 'rgba(0,0,0,0.5)';
superpoderIndicator.style.color = 'cyan';
superpoderIndicator.style.fontFamily = 'Arial';
superpoderIndicator.style.fontSize = '16px';
superpoderIndicator.style.borderRadius = '8px';
superpoderIndicator.style.textAlign = 'center';
superpoderIndicator.style.display = 'none';
document.body.appendChild(superpoderIndicator);
*/

// Crear fondo oscuro (overlay), oculto inicialmente
const overlay = document.createElement('div');
overlay.style.position = 'fixed';
overlay.style.top = '0';
overlay.style.left = '0';
overlay.style.width = '100%';
overlay.style.height = '100%';
overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)'; // Negro con transparencia
overlay.style.display = 'none';
overlay.style.zIndex = '999'; // Debajo de la imagen
document.body.appendChild(overlay);

// Crear imagen grande (oculta inicialmente)
const imagenGrande = document.createElement('img');
imagenGrande.src = './img/Mapa.png'; // <-- Cambia esto por tu imagen
imagenGrande.style.position = 'fixed';
imagenGrande.style.top = '50%';
imagenGrande.style.left = '50%';
imagenGrande.style.transform = 'translate(-50%, -50%)';
imagenGrande.style.maxWidth = '80%';
imagenGrande.style.maxHeight = '80%';
imagenGrande.style.display = 'none';
imagenGrande.style.zIndex = '1000'; // Encima del overlay
document.body.appendChild(imagenGrande);

overlay.style.transition = 'opacity 0.4s';

let juegoPausado = false;
let intervaloContador = null; // Para controlar el cronómetro y pausarlo
let tiempoRestante = 8.1 * 60;  // Mover esta variable fuera de la función iniciarContador

let menuVRGroup;
let botonReanudarVR;
let botonSalirVR;

let vrContadorSprite;
let vrContadorText = '';
let vrFooterSprite;

// Función para iniciar la cuenta regresiva de 8 minutos
function iniciarContador() {
    function actualizarContador() {
        const minutos = Math.floor(tiempoRestante / 60);
        const segundos = tiempoRestante % 60;
        vrContadorText = `Tiempo restante: ${minutos}:${segundos.toString().padStart(2, '0')}`;
        actualizarVRContador(vrContadorText);


        if (tiempoRestante <= 0) {
            clearInterval(intervaloContador);
            vrContadorText = '¡Tiempo agotado!';
            actualizarVRContador(vrContadorText);

            mostrarPantallaDerrota(); // <-- Agrega esta línea aquí
        }
    }

    actualizarContador(); // Mostrar de inmediato
    intervaloContador = setInterval(() => {
        if (!juegoPausado && tiempoRestante > 0) {
            tiempoRestante--;
            actualizarContador();
        }
    }, 1000);

}

function actualizarVRContador(texto) {
    const canvas = vrContadorSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(texto, canvas.width / 2, 80);

    vrContadorSprite.material.map.needsUpdate = true;
}

function actualizarVRDistancia(texto, color = 'lime') {
    const canvas = vrDistanciaSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = '36px Arial';
    ctx.textAlign = 'center';

    const lineas = texto.split('\n');
    for (let i = 0; i < lineas.length; i++) {
        ctx.fillText(lineas[i], canvas.width / 2, 50 + i * 40);
    }

    vrDistanciaSprite.material.map.needsUpdate = true;
}

function actualizarVRMensaje(texto) {
    console.log("Mensaje VR:", texto); // 👈 Añade esta línea

    const canvas = vrMensajeSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '42px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(texto, canvas.width / 2, 80);

    vrMensajeSprite.material.map.needsUpdate = true;
}

const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();

let playerOnFloor = false;
let mouseTime = 0;

const keyStates = {};

const vector1 = new THREE.Vector3();
const vector2 = new THREE.Vector3();
const vector3 = new THREE.Vector3();

let imagenMostrada = false;

document.addEventListener('keydown', (event) => {

    keyStates[event.code] = true;

    // Alternar visibilidad de la imagen con la tecla "m"
    if (event.code === 'KeyM') {
        if (imagenGrande.style.display === 'none') {
            overlay.style.display = 'block';
            overlay.style.opacity = '0';
            imagenMostrada = true;
            requestAnimationFrame(() => {
                overlay.style.opacity = '1';
            });
            imagenGrande.style.display = 'block';
        } else {
            overlay.style.opacity = '0';
            imagenMostrada = false;
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 300);
            imagenGrande.style.display = 'none';
        }
    }

    if (event.code === 'KeyP') {
        if (!juegoPausado) {
            pausarJuego();
        } else {
            reanudarJuego();
        }
    }

});

document.addEventListener('keyup', (event) => {

    keyStates[event.code] = false;

});

container.addEventListener('mousedown', () => {

    document.body.requestPointerLock();

    mouseTime = performance.now();

});

document.addEventListener('mouseup', () => {

    if (document.pointerLockElement !== null) throwBall();

});

document.body.addEventListener('mousemove', (event) => {

    if (document.pointerLockElement === document.body) {

        camera.rotation.y -= event.movementX / 500;
        camera.rotation.x -= event.movementY / 500;

    }

});

window.addEventListener('resize', onWindowResize);

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

}

function throwBall() {
    if (juegoPausado) return;

    const sphere = spheres[sphereIdx];

    // Obtener dirección del controlador (derecho)
    const controllerMatrix = controller.matrixWorld;
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1); // dirección hacia adelante del control

    origin.setFromMatrixPosition(controllerMatrix);
    direction.applyMatrix4(new THREE.Matrix4().extractRotation(controllerMatrix)).normalize();

    // Posición inicial: un poco delante del controlador
    sphere.collider.center.copy(origin).addScaledVector(direction, 0.5);

    // Velocidad inicial hacia donde apunta el control
    const impulse = 20; // Puedes ajustar la fuerza
    sphere.velocity.copy(direction).multiplyScalar(impulse);

    sphereIdx = (sphereIdx + 1) % spheres.length;
}

function playerCollisions() {

    const result = worldOctree.capsuleIntersect(playerCollider);

    playerOnFloor = false;

    if (result) {

        playerOnFloor = result.normal.y > 0;

        if (!playerOnFloor) {

            playerVelocity.addScaledVector(result.normal, - result.normal.dot(playerVelocity));

        }

        if (result.depth >= 1e-10) {

            playerCollider.translate(result.normal.multiplyScalar(result.depth));

        }

    }

}

function updatePlayer(deltaTime) {

    let damping = Math.exp(- 4 * deltaTime) - 1;

    if (!playerOnFloor) {

        playerVelocity.y -= (GRAVITY + GRAVITY_SUPLEMENTO) * deltaTime;

        // small air resistance
        damping *= 0.1;

    }

    playerVelocity.addScaledVector(playerVelocity, damping);

    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    playerCollider.translate(deltaPosition);

    playerCollisions();

    playerRig.position.copy(playerCollider.end.clone().add(new THREE.Vector3(0, -0.65, 0)));

}

function playerSphereCollision(sphere) {

    const center = vector1.addVectors(playerCollider.start, playerCollider.end).multiplyScalar(0.5);

    const sphere_center = sphere.collider.center;

    const r = playerCollider.radius + sphere.collider.radius;
    const r2 = r * r;

    // approximation: player = 3 spheres

    for (const point of [playerCollider.start, playerCollider.end, center]) {

        const d2 = point.distanceToSquared(sphere_center);

        if (d2 < r2) {

            const normal = vector1.subVectors(point, sphere_center).normalize();
            const v1 = vector2.copy(normal).multiplyScalar(normal.dot(playerVelocity));
            const v2 = vector3.copy(normal).multiplyScalar(normal.dot(sphere.velocity));

            playerVelocity.add(v2).sub(v1);
            sphere.velocity.add(v1).sub(v2);

            const d = (r - Math.sqrt(d2)) / 2;
            sphere_center.addScaledVector(normal, - d);

        }

    }

}

function spheresCollisions() {

    for (let i = 0, length = spheres.length; i < length; i++) {

        const s1 = spheres[i];

        for (let j = i + 1; j < length; j++) {

            const s2 = spheres[j];

            const d2 = s1.collider.center.distanceToSquared(s2.collider.center);
            const r = s1.collider.radius + s2.collider.radius;
            const r2 = r * r;

            if (d2 < r2) {

                const normal = vector1.subVectors(s1.collider.center, s2.collider.center).normalize();
                const v1 = vector2.copy(normal).multiplyScalar(normal.dot(s1.velocity));
                const v2 = vector3.copy(normal).multiplyScalar(normal.dot(s2.velocity));

                s1.velocity.add(v2).sub(v1);
                s2.velocity.add(v1).sub(v2);

                const d = (r - Math.sqrt(d2)) / 2;

                s1.collider.center.addScaledVector(normal, d);
                s2.collider.center.addScaledVector(normal, - d);

            }

        }

    }

}

function updateSpheres(deltaTime) {

    spheres.forEach(sphere => {

        sphere.collider.center.addScaledVector(sphere.velocity, deltaTime);

        const result = worldOctree.sphereIntersect(sphere.collider);

        if (result) {

            sphere.velocity.addScaledVector(result.normal, - result.normal.dot(sphere.velocity) * 1.5);
            sphere.collider.center.add(result.normal.multiplyScalar(result.depth));

        } else {

            sphere.velocity.y -= GRAVITY * deltaTime;

        }

        const damping = Math.exp(- 1.5 * deltaTime) - 1;
        sphere.velocity.addScaledVector(sphere.velocity, damping);

        playerSphereCollision(sphere);

        cubosSuperpoder.forEach(cubo => {
            const distancia = sphere.collider.center.distanceTo(cubo.position);
            const umbral = SPHERE_RADIUS + 1.5;

            if (distancia < umbral && !cubo.usado) {
                cubo.usado = true;

                // Desaparecer cubo y esfera
                scene.remove(cubo);
                scene.remove(sphere.mesh);
                sphere.collider.center.set(0, -100, 0);  // Mover esfera fuera del mapa
                sphere.velocity.set(0, 0, 0);

                activarSuperpoder();
            }
        });
    });

    spheresCollisions();

    for (const sphere of spheres) {

        sphere.mesh.position.copy(sphere.collider.center);

    }

}

function getForwardVector() {
    const xrCamera = renderer.xr.getCamera(camera); // obtiene XRArrayCamera
    const direction = new THREE.Vector3();
    xrCamera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    return direction;
}

function getSideVector() {
    const xrCamera = renderer.xr.getCamera(camera);
    const direction = new THREE.Vector3();
    xrCamera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    direction.cross(new THREE.Vector3(0, 1, 0));
    return direction;
}

function controls(deltaTime) {

    if (juegoPausado || juegoGanado || imagenMostrada) return;  // No mover si está pausado

    // gives a bit of air control
    const speedDelta = deltaTime * (playerOnFloor ? 25 : 8) * SPEED_MULTIPLIER;

    if (keyStates['KeyW']) {

        playerVelocity.add(getForwardVector().multiplyScalar(speedDelta));

    }

    if (keyStates['KeyS']) {

        playerVelocity.add(getForwardVector().multiplyScalar(- speedDelta));

    }

    if (keyStates['KeyA']) {

        playerVelocity.add(getSideVector().multiplyScalar(- speedDelta));

    }

    if (keyStates['KeyD']) {

        playerVelocity.add(getSideVector().multiplyScalar(speedDelta));

    }

    if (playerOnFloor) {

        if (keyStates['Space']) {

            playerVelocity.y = 15;

        }

    }

}

const loader = new GLTFLoader().setPath('./models/');

let playerRig;

loader.load('Laberinto.glb', (gltf) => {

    scene.add(gltf.scene);

    worldOctree.fromGraphNode(gltf.scene);

    gltf.scene.traverse(child => {

        if (child.isMesh) {

            child.castShadow = true;
            child.receiveShadow = true;

            if (child.material.map) {

                child.material.map.anisotropy = 4;

            }

        }

    });

    playerRig = new THREE.Group();
    playerRig.position.copy(playerStart); // usa la misma posición
    playerRig.position.set(40, 1, 1); // Esta es la posición inicial
    playerRig.add(camera);
    playerRig.rotation.y = Math.PI / 2; // 👉 Esto hará que mire hacia +Z

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Tiempo restante: 8:00', canvas.width / 2, 80);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    vrContadorSprite = new THREE.Sprite(material);
    vrContadorSprite.scale.set(1.26, 0.3, 0.12); // tamaño del sprite

    camera.add(vrContadorSprite);
    vrContadorSprite.position.set(0, 1, -2); // delante y debajo del centro visual

    // Crear grupo que contiene el menú de pausa en VR
    menuVRGroup = new THREE.Group();
    menuVRGroup.visible = false; // Oculto al inicio
    camera.add(menuVRGroup);
    menuVRGroup.position.set(0, 0, -2); // Justo al frente del visor

    // Fondo negro del menú
    const fondoMenu = new THREE.Mesh(
        new THREE.PlaneGeometry(3.5, 2),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.8 })
    );
    menuVRGroup.add(fondoMenu);

    // Botón Reanudar
    botonReanudarVR = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.4, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x4444ff })
    );
    botonReanudarVR.position.set(0, 0.4, 0.01);
    botonReanudarVR.name = 'reanudar';
    menuVRGroup.add(botonReanudarVR);

    // Texto "Reanudar"
    const canvas1 = document.createElement('canvas');
    canvas1.width = 256;
    canvas1.height = 64;
    const ctx1 = canvas1.getContext('2d');
    ctx1.fillStyle = 'white';
    ctx1.font = '32px Arial';
    ctx1.textAlign = 'center';
    ctx1.fillText('Reanudar', 128, 40);
    const tex1 = new THREE.CanvasTexture(canvas1);
    const textoReanudar = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.4),
        new THREE.MeshBasicMaterial({ map: tex1, transparent: true })
    );
    textoReanudar.position.copy(botonReanudarVR.position);
    textoReanudar.position.z += 0.03;
    menuVRGroup.add(textoReanudar);

    // Botón Salir
    botonSalirVR = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.4, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    botonSalirVR.position.set(0, -0.3, 0.01);
    botonSalirVR.name = 'salir';
    menuVRGroup.add(botonSalirVR);

    // Texto "Salir"
    const canvas2 = document.createElement('canvas');
    canvas2.width = 256;
    canvas2.height = 64;
    const ctx2 = canvas2.getContext('2d');
    ctx2.fillStyle = 'white';
    ctx2.font = '32px Arial';
    ctx2.textAlign = 'center';
    ctx2.fillText('Salir', 128, 40);
    const tex2 = new THREE.CanvasTexture(canvas2);
    const textoSalir = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.4),
        new THREE.MeshBasicMaterial({ map: tex2, transparent: true })
    );
    textoSalir.position.copy(botonSalirVR.position);
    textoSalir.position.z += 0.03;
    menuVRGroup.add(textoSalir);

    const canvasDistancia = document.createElement('canvas');
    canvasDistancia.width = 512;
    canvasDistancia.height = 128;
    const ctxDistancia = canvasDistancia.getContext('2d');

    ctxDistancia.fillStyle = 'rgba(0,0,0,0.5)';
    ctxDistancia.fillRect(0, 0, canvasDistancia.width, canvasDistancia.height);
    ctxDistancia.fillStyle = 'lime';
    ctxDistancia.font = '40px Arial';
    ctxDistancia.textAlign = 'center';
    ctxDistancia.fillText('Calculando...', canvasDistancia.width / 2, 80);

    const textureDistancia = new THREE.CanvasTexture(canvasDistancia);
    const materialDistancia = new THREE.SpriteMaterial({ map: textureDistancia });
    vrDistanciaSprite = new THREE.Sprite(materialDistancia);
    vrDistanciaSprite.scale.set(1.62, 0.3, 0.54); // 60% de cada valor original

    camera.add(vrDistanciaSprite);
    vrDistanciaSprite.position.set(2.7, 1, -2); // 👈 arriba a la derecha

    const canvasMsg = document.createElement('canvas');
    canvasMsg.width = 512;
    canvasMsg.height = 128;
    const ctxMsg = canvasMsg.getContext('2d');

    ctxMsg.fillStyle = 'rgba(0,0,0,0.5)';
    ctxMsg.fillRect(0, 0, canvasMsg.width, canvasMsg.height);
    ctxMsg.fillStyle = 'white';
    ctxMsg.font = '42px Arial';
    ctxMsg.textAlign = 'center';
    ctxMsg.fillText('Interactúa con la bomba', canvasMsg.width / 2, 80);

    const textureMsg = new THREE.CanvasTexture(canvasMsg);
    const materialMsg = new THREE.SpriteMaterial({ map: textureMsg, transparent: true });
    vrMensajeSprite = new THREE.Sprite(materialMsg);
    vrMensajeSprite.scale.set(2.5, 0.6, 1);

    // Por defecto oculto (lo movemos lejos al inicio)
    vrMensajeSprite.position.set(0, -5, 0);
    camera.add(vrMensajeSprite);

    const canvasSP = document.createElement('canvas');
    canvasSP.width = 512;
    canvasSP.height = 128;
    const ctxSP = canvasSP.getContext('2d');

    ctxSP.fillStyle = 'rgba(0,0,0,0.5)';
    ctxSP.fillRect(0, 0, canvasSP.width, canvasSP.height);
    ctxSP.fillStyle = 'cyan';
    ctxSP.font = '38px Arial';
    ctxSP.textAlign = 'center';
    ctxSP.fillText('Superpoder: ---', canvasSP.width / 2, 80);

    const textureSP = new THREE.CanvasTexture(canvasSP);
    const materialSP = new THREE.SpriteMaterial({ map: textureSP });
    vrSuperpoderSprite = new THREE.Sprite(materialSP);
    vrSuperpoderSprite.scale.set(2.5, 0.6, 1);
    vrSuperpoderSprite.position.set(0, 1.0, -2); // Centro superior del visor
    camera.add(vrSuperpoderSprite);
    vrSuperpoderSprite.visible = false;

    const canvasMSP = document.createElement('canvas');
    canvasMSP.width = 512;
    canvasMSP.height = 128;
    const ctxMSP = canvasMSP.getContext('2d');

    ctxMSP.fillStyle = 'rgba(0,0,0,0.7)';
    ctxMSP.fillRect(0, 0, canvasMSP.width, canvasMSP.height);
    ctxMSP.fillStyle = 'yellow';
    ctxMSP.font = '42px Arial';
    ctxMSP.textAlign = 'center';
    ctxMSP.fillText('¡Superpoder!', canvasMSP.width / 2, 80);

    const textureMSP = new THREE.CanvasTexture(canvasMSP);
    const materialMSP = new THREE.SpriteMaterial({ map: textureMSP });
    vrMensajeSuperpoderSprite = new THREE.Sprite(materialMSP);
    vrMensajeSuperpoderSprite.scale.set(3, 0.7, 1);
    vrMensajeSuperpoderSprite.position.set(0, 0.2, -2);
    camera.add(vrMensajeSuperpoderSprite);
    vrMensajeSuperpoderSprite.visible = false;

    const canvasDerrota = document.createElement('canvas');
    canvasDerrota.width = 1024;
    canvasDerrota.height = 512;
    const ctxDerrota = canvasDerrota.getContext('2d');

    ctxDerrota.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctxDerrota.fillRect(0, 0, canvasDerrota.width, canvasDerrota.height);
    ctxDerrota.fillStyle = 'red';
    ctxDerrota.font = 'bold 60px Arial';
    ctxDerrota.textAlign = 'center';
    ctxDerrota.fillText('¡Tiempo agotado!', canvasDerrota.width / 2, 200);
    ctxDerrota.fillText('Has perdido...', canvasDerrota.width / 2, 300);

    const textureDerrota = new THREE.CanvasTexture(canvasDerrota);
    const materialDerrota = new THREE.SpriteMaterial({ map: textureDerrota });
    vrPantallaDerrotaSprite = new THREE.Sprite(materialDerrota);
    vrPantallaDerrotaSprite.scale.set(6, 3, 1);
    vrPantallaDerrotaSprite.position.set(0, 0, -4);
    vrPantallaDerrotaSprite.visible = false;

    camera.add(vrPantallaDerrotaSprite);

    const canvasVictoria = document.createElement('canvas');
    canvasVictoria.width = 1024;
    canvasVictoria.height = 512;
    const ctxVictoria = canvasVictoria.getContext('2d');

    ctxVictoria.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctxVictoria.fillRect(0, 0, canvasVictoria.width, canvasVictoria.height);
    ctxVictoria.fillStyle = 'lime';
    ctxVictoria.font = 'bold 60px Arial';
    ctxVictoria.textAlign = 'center';
    ctxVictoria.fillText('¡Felicidades!', canvasVictoria.width / 2, 200);
    ctxVictoria.fillText('Has desactivado todas las bombas', canvasVictoria.width / 2, 300);

    const textureVictoria = new THREE.CanvasTexture(canvasVictoria);
    const materialVictoria = new THREE.SpriteMaterial({ map: textureVictoria });
    vrPantallaVictoriaSprite = new THREE.Sprite(materialVictoria);
    vrPantallaVictoriaSprite.scale.set(6, 3, 1);
    vrPantallaVictoriaSprite.position.set(0, 0, -4);
    vrPantallaVictoriaSprite.visible = false;

    camera.add(vrPantallaVictoriaSprite);

    const canvasFooter = document.createElement('canvas');
    canvasFooter.width = 1024;
    canvasFooter.height = 128;
    const ctxFooter = canvasFooter.getContext('2d');

    ctxFooter.fillStyle = 'rgba(0, 0, 0, 0)';
    ctxFooter.fillRect(0, 0, canvasFooter.width, canvasFooter.height);
    ctxFooter.fillStyle = 'white';
    ctxFooter.font = '28px Monospace';
    ctxFooter.textAlign = 'center';
    ctxFooter.fillText('©2025. Derechos reservados | Juan Armando Castillo Rodríguez', canvasFooter.width / 2, 80);

    const textureFooter = new THREE.CanvasTexture(canvasFooter);
    const materialFooter = new THREE.SpriteMaterial({ map: textureFooter, transparent: true });
    vrFooterSprite = new THREE.Sprite(materialFooter);
    vrFooterSprite.scale.set(5, 0.6, 1); // ancho, alto, profundidad

    vrFooterSprite.position.set(0, -1, -2); // parte inferior del visor
    camera.add(vrFooterSprite);

    scene.add(playerRig);

    // Llamar a iniciarContador() cuando se genere el personaje
    // (Solo llama esto en la función donde creas al personaje)
    iniciarContador();
    renderer.setAnimationLoop(animate);
});

function teleportPlayerIfOob() {
    if (playerCollider.end.y < -20) {
        playerVelocity.set(0, 0, 0);
        playerRig.position.set(40, 1, 1); // <-- posición de reaparición
    }
}

// Footer
/*
const footer = document.createElement('footer');
footer.innerHTML = '<p style="text-align:center; padding:10px; color:white; position:fixed; bottom:0; width:100%; font-size: 18px; font-family:\'Monospace\', sans-serif;">&copy; 2025. Todos los derechos reservados | Juan Armando Castillo Rodríguez</p>';
document.body.appendChild(footer);
*/

// Variables para referencia de las bombas
let bombaOriginal, bombaClon1, bombaClon2, bombaClon3, bombaClon4, bombaClon5, bombaClon6, bombaClon7, bombaClon8, bombaClon9;

// Crear elemento HTML para mostrar distancia (HUD a la derecha)
/*const distanciaIndicator = document.createElement('div');
distanciaIndicator.style.position = 'absolute';
distanciaIndicator.style.top = '20px';
distanciaIndicator.style.right = '15px'; // <-- Mover a la derecha
distanciaIndicator.style.padding = '10px';
distanciaIndicator.style.backgroundColor = 'rgba(0,0,0,0.5)';
distanciaIndicator.style.color = 'lime';
distanciaIndicator.style.fontFamily = 'Arial';
distanciaIndicator.style.fontSize = '16px';
distanciaIndicator.style.borderRadius = '8px';
distanciaIndicator.style.whiteSpace = 'pre'; // Permitir saltos de línea con \n
document.body.appendChild(distanciaIndicator);
*/
/*
const mensajeInteraccion = document.createElement('div');
mensajeInteraccion.style.position = 'absolute';
mensajeInteraccion.style.bottom = '20px';
mensajeInteraccion.style.left = '50%';
mensajeInteraccion.style.transform = 'translateX(-50%)';
mensajeInteraccion.style.padding = '12px 20px';
mensajeInteraccion.style.backgroundColor = 'rgba(0,0,0,0.7)';
mensajeInteraccion.style.color = 'white';
mensajeInteraccion.style.fontFamily = 'Arial';
mensajeInteraccion.style.fontSize = '18px';
mensajeInteraccion.style.borderRadius = '10px';
mensajeInteraccion.style.display = 'none'; // Oculto por defecto
document.body.appendChild(mensajeInteraccion);
*/
/*
const mensajeSuperpoder = document.createElement('div');
mensajeSuperpoder.style.position = 'absolute';
mensajeSuperpoder.style.top = '50%';
mensajeSuperpoder.style.left = '50%';
mensajeSuperpoder.style.transform = 'translate(-50%, -50%)';
mensajeSuperpoder.style.padding = '20px 40px';
mensajeSuperpoder.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
mensajeSuperpoder.style.color = 'yellow';
mensajeSuperpoder.style.fontFamily = 'Arial';
mensajeSuperpoder.style.fontSize = '28px';
mensajeSuperpoder.style.borderRadius = '12px';
mensajeSuperpoder.style.display = 'none';
mensajeSuperpoder.style.zIndex = '1001';
document.body.appendChild(mensajeSuperpoder);
*/

let bombaInteractuable = null;
let bombaDesactivada = new Set(); // Para no desactivar la misma bomba múltiples veces
let desactivando = false;

let bombaEnProceso = null;
let desactivarTimeout = null;

let tiempoTranscurrido = 0;
let cronometroActivo = true;

let juegoGanado = false;

const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();

function animate() {

    const delta = clock.getDelta();
    const deltaTime = Math.min(0.05, delta) / STEPS_PER_FRAME;

    // NUEVO: Obtener posición real del visor (headset)
    const vrCamera = renderer.xr.getCamera(camera); // <- Cámara estéreo real
    const headsetPosition = new THREE.Vector3();
    headsetPosition.setFromMatrixPosition(vrCamera.matrixWorld);

    for (let i = 0; i < STEPS_PER_FRAME; i++) {

        controls(deltaTime);
        processControllerInput(deltaTime);
        updatePlayer(deltaTime);
        updateSpheres(deltaTime);
        teleportPlayerIfOob();

    }

    // Actualizar indicador de distancia a bombas
    if (bombaOriginal && bombaClon1 && bombaClon2 && bombaClon3 && bombaClon4 && bombaClon5 && bombaClon6 && bombaClon7 && bombaClon8 && bombaClon9) {

        const distOriginal = headsetPosition.distanceTo(bombaOriginal.position);
        const distClon1 = headsetPosition.distanceTo(bombaClon1.position);
        const distClon2 = headsetPosition.distanceTo(bombaClon2.position);
        const distClon3 = headsetPosition.distanceTo(bombaClon3.position);
        const distClon4 = headsetPosition.distanceTo(bombaClon4.position);
        const distClon5 = headsetPosition.distanceTo(bombaClon5.position);
        const distClon6 = headsetPosition.distanceTo(bombaClon6.position);
        const distClon7 = headsetPosition.distanceTo(bombaClon7.position);
        const distClon8 = headsetPosition.distanceTo(bombaClon8.position);
        const distClon9 = headsetPosition.distanceTo(bombaClon9.position);


        // Determinar bomba más cercana y su distancia
        const distancias = [
            { nombre: 'Bomba 1', distancia: distOriginal, objeto: bombaOriginal },
            { nombre: 'Bomba 2', distancia: distClon1, objeto: bombaClon1 },
            { nombre: 'Bomba 3', distancia: distClon2, objeto: bombaClon2 },
            { nombre: 'Bomba 4', distancia: distClon3, objeto: bombaClon3 },
            { nombre: 'Bomba 5', distancia: distClon4, objeto: bombaClon4 },
            { nombre: 'Bomba 6', distancia: distClon5, objeto: bombaClon5 },
            { nombre: 'Bomba 7', distancia: distClon6, objeto: bombaClon6 },
            { nombre: 'Bomba 8', distancia: distClon7, objeto: bombaClon7 },
            { nombre: 'Bomba 9', distancia: distClon8, objeto: bombaClon8 },
            { nombre: 'Bomba 10', distancia: distClon9, objeto: bombaClon9 }
        ].filter(bomba => !bombaDesactivada.has(bomba.objeto));

        if (distancias.length > 0) {
            distancias.sort((a, b) => a.distancia - b.distancia);
            const bombaCercana = distancias[0];

            // Resto del código igual
            let color = 'lime';
            if (bombaCercana.distancia < 5) {
                color = 'red';
            } else if (bombaCercana.distancia < 15) {
                color = 'orange';
            }

            const texto = `${bombaCercana.nombre}\nDistancia: ${bombaCercana.distancia.toFixed(2)} m`;
            actualizarVRDistancia(texto, color);

            if (!mensajeBombaDesactivadaActivo) {
                if (!desactivando && bombaCercana.distancia < 2.5 && !bombaDesactivada.has(bombaCercana.objeto)) {
                    vrMensajeSprite.position.set(0, -0.8, -2);
                    actualizarVRMensaje('"A" para desactivar');
                    bombaInteractuable = bombaCercana.objeto;
                } else {
                    vrMensajeSprite.position.set(0, -5, 0);
                    bombaInteractuable = null;
                }
            }

        } else {
            // Si ya no hay bombas activas
            actualizarVRDistancia('Todas las bombas\nestán desactivadas', 'white');
            mensajeInteraccion.style.display = 'none';
            bombaInteractuable = null;

            mostrarPantallaVictoria();

            // Detener cronómetro (si tienes una variable como 'cronometroActivo')
            cronometroActivo = false;

            cronometroActivo = false;
            juegoGanado = true; // <-- IMPORTANTE

            if (!document.getElementById('victoriaOverlay')) {

                document.exitPointerLock();

                // Fondo negro translúcido detrás del mensaje
                const fondoOscuro = document.createElement('div');
                fondoOscuro.style.position = 'fixed';
                fondoOscuro.style.top = '0';
                fondoOscuro.style.left = '0';
                fondoOscuro.style.width = '100%';
                fondoOscuro.style.height = '100%';
                fondoOscuro.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
                fondoOscuro.style.zIndex = '1001';
                document.body.appendChild(fondoOscuro);

                const victoriaOverlay = document.createElement('div');
                victoriaOverlay.id = 'victoriaOverlay';
                victoriaOverlay.style.position = 'fixed';
                victoriaOverlay.style.top = '50%';
                victoriaOverlay.style.left = '50%';
                victoriaOverlay.style.transform = 'translate(-50%, -50%)';
                victoriaOverlay.style.backgroundColor = 'rgba(0,0,0,0.9)';
                victoriaOverlay.style.padding = '40px 60px';
                victoriaOverlay.style.borderRadius = '12px';
                victoriaOverlay.style.color = 'white';
                victoriaOverlay.style.fontFamily = 'Arial';
                victoriaOverlay.style.fontSize = '32px';
                victoriaOverlay.style.fontWeight = 'bold';
                victoriaOverlay.style.textAlign = 'center';
                victoriaOverlay.style.zIndex = '1002';

                const tiempoFinal = Math.floor(tiempoTranscurrido);
                victoriaOverlay.innerHTML = `🎉 ¡Has ganado! 🎉<br><br>Tiempo: ${tiempoFinal} segundos<br><br>`;

                const botonSalirFinal = document.createElement('button');
                botonSalirFinal.textContent = 'Salir';
                botonSalirFinal.style.marginTop = '20px';
                botonSalirFinal.style.padding = '10px 25px';
                botonSalirFinal.style.fontSize = '20px';
                botonSalirFinal.onclick = () => location.reload();

                victoriaOverlay.appendChild(botonSalirFinal);
                document.body.appendChild(victoriaOverlay);
            }
        }

        if (cronometroActivo) {
            tiempoTranscurrido += delta;
        }

    }

    const rigPosition = playerRig.position;
    playerCollider.start.set(rigPosition.x, rigPosition.y, rigPosition.z);
    playerCollider.end.set(rigPosition.x, rigPosition.y + 0.65, rigPosition.z);

    renderer.render(scene, camera);

    if (menuVRGroup.visible) {
        tempMatrix.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        const intersected = raycaster.intersectObjects([botonReanudarVR, botonSalirVR], false);

        if (intersected.length > 0) {
            const boton = intersected[0].object;

            // Destacar el botón
            boton.material.color.set(0xffff00);

            // Si se presiona el gatillo
            if (controller.userData.selectPressed && boton.name === 'reanudar') {
                toggleMenuVR(); // Ocultar menú y reanudar
            }

            if (controller.userData.selectPressed && boton.name === 'salir') {
                location.href = 'index.html'; // O salir del juego
            }
        } else {
            // Resetear colores si no hay colisión
            botonReanudarVR.material.color.set(0x4444ff);
            botonSalirVR.material.color.set(0xff4444);
        }
    }

}

window.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'e' && bombaInteractuable && !bombaDesactivada.has(bombaInteractuable)) {
        desactivarBomba(bombaInteractuable);
    }
});

import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const CHARACTER_PATH = "./models/Bomba.glb";

function loadGLTF(url) {
    return new Promise((resolve, reject) => {
        new GLTFLoader().load(
            url,
            (gltf) => resolve(gltf),
            undefined,
            (error) => reject(error)
        );
    });
}

loadGLTF(CHARACTER_PATH)
    .then((gltf) => {
        scene.add(gltf.scene);

        const clone = SkeletonUtils.clone(gltf.scene);
        const clone2 = SkeletonUtils.clone(gltf.scene);
        const clone3 = SkeletonUtils.clone(gltf.scene);
        const clone4 = SkeletonUtils.clone(gltf.scene);
        const clone5 = SkeletonUtils.clone(gltf.scene);
        const clone6 = SkeletonUtils.clone(gltf.scene);
        const clone7 = SkeletonUtils.clone(gltf.scene);
        const clone8 = SkeletonUtils.clone(gltf.scene);
        const clone9 = SkeletonUtils.clone(gltf.scene);

        gltf.scene.position.set(0, 0, 3);
        gltf.scene.scale.set(1.2, 1.2, 1.2);

        clone.position.set(18, 0, 0);
        clone.scale.set(1.2, 1.2, 1.2);
        clone.rotation.y = Math.PI / -2;

        clone2.position.set(20, 0, 25);
        clone2.scale.set(1.2, 1.2, 1.2);
        clone2.rotation.y = Math.PI / 2;

        clone3.position.set(-10, 0, -25);
        clone3.scale.set(1.2, 1.2, 1.2);

        clone4.position.set(30, 0, -11);
        clone4.scale.set(1.2, 1.2, 1.2);
        clone4.rotation.y = Math.PI / -2;

        clone5.position.set(-10, 0, 20);
        clone5.scale.set(1.2, 1.2, 1.2);
        clone5.rotation.y = Math.PI / 2;

        clone6.position.set(20, 0, 0);
        clone6.scale.set(1.2, 1.2, 1.2);
        clone6.rotation.y = Math.PI / 2;

        clone7.position.set(-20, 0, 5);
        clone7.scale.set(1.2, 1.2, 1.2);
        clone7.rotation.y = Math.PI / -2;

        clone8.position.set(-25, 0, 15);
        clone8.scale.set(1.2, 1.2, 1.2);
        clone7.rotation.y = Math.PI / -2;

        clone9.position.set(-40, 0, 0);
        clone9.scale.set(1.2, 1.2, 1.2);
        clone9.rotation.y = Math.PI / 2;

        scene.add(clone);
        scene.add(clone2, clone3, clone4, clone5, clone6, clone7, clone8, clone9);

        // Guarda las referencias globales
        bombaOriginal = gltf.scene;
        bombaClon1 = clone;
        bombaClon2 = clone2;
        bombaClon3 = clone3;
        bombaClon4 = clone4;
        bombaClon5 = clone5;
        bombaClon6 = clone6;
        bombaClon7 = clone7;
        bombaClon8 = clone8;
        bombaClon9 = clone9;
    })
    .catch((error) => {
        console.log(error);
    });

const canvasPausa = document.createElement('canvas');
canvasPausa.width = 1024;
canvasPausa.height = 512;
const ctxPausa = canvasPausa.getContext('2d');

ctxPausa.fillStyle = 'rgba(0, 0, 0, 0.8)';
ctxPausa.fillRect(0, 0, canvasPausa.width, canvasPausa.height);

ctxPausa.fillStyle = 'white';
ctxPausa.font = '60px Arial';
ctxPausa.textAlign = 'center';
ctxPausa.fillText('PAUSADO', canvasPausa.width / 2, 100);

// Botón 1: Reanudar
ctxPausa.fillStyle = 'gray';
ctxPausa.fillRect(362, 200, 300, 80);
ctxPausa.fillStyle = 'white';
ctxPausa.fillText('Reanudar', canvasPausa.width / 2, 260);

// Botón 2: Salir
ctxPausa.fillStyle = 'gray';
ctxPausa.fillRect(362, 320, 300, 80);
ctxPausa.fillStyle = 'white';
ctxPausa.fillText('Salir', canvasPausa.width / 2, 380);

const texturaPausa = new THREE.CanvasTexture(canvasPausa);
const materialPausa = new THREE.SpriteMaterial({ map: texturaPausa });
const spritePausaMenu = new THREE.Sprite(materialPausa);
spritePausaMenu.scale.set(4, 2, 1); // tamaño visible en VR

/*
// Oculto inicialmente
spritePausaMenu.position.set(0, -5, 0);
camera.add(spritePausaMenu);
*/

let menuVRActivo = false;

function toggleMenuVR() {
    if (!menuVRGroup) return; // aún no cargado

    menuVRGroup.visible = !menuVRGroup.visible;
    juegoPausado = menuVRGroup.visible;

    if (!menuVRGroup.visible) {
        controller.userData.selectPressed = false;
    }
}

// Menú de pausa (overlay oscuro con botones)
/*
const pausaMenu = document.createElement('div');
pausaMenu.style.position = 'fixed';
pausaMenu.style.top = '50%';
pausaMenu.style.left = '50%';
pausaMenu.style.transform = 'translate(-50%, -50%)';
pausaMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
pausaMenu.style.padding = '30px';
pausaMenu.style.borderRadius = '10px';
pausaMenu.style.display = 'none';
pausaMenu.style.zIndex = '1001';
pausaMenu.style.textAlign = 'center';
*/
/*
// Botón Reanudar
const botonReanudar = document.createElement('button');
botonReanudar.textContent = 'Reanudar';
botonReanudar.style.margin = '10px';
botonReanudar.style.padding = '10px 20px';
botonReanudar.style.fontSize = '18px';
botonReanudar.onclick = reanudarJuego;
pausaMenu.appendChild(botonReanudar);

// Botón Salir
const botonSalir = document.createElement('button');
botonSalir.textContent = 'Salir';
botonSalir.style.margin = '10px';
botonSalir.style.padding = '10px 20px';
botonSalir.style.fontSize = '18px';
botonSalir.onclick = () => location.href = 'index.html'; // Redirige a otra página
pausaMenu.appendChild(botonSalir);

// Crear texto "PAUSADO" (oculto inicialmente)
const textoPausado = document.createElement('div');
textoPausado.textContent = 'PAUSADO';
textoPausado.style.position = 'fixed';
textoPausado.style.top = '35%';
textoPausado.style.left = '50%';
textoPausado.style.transform = 'translate(-50%, -50%)';
textoPausado.style.color = 'white';
textoPausado.style.fontFamily = 'Arial';
textoPausado.style.fontSize = '48px';
textoPausado.style.fontWeight = 'bold';
textoPausado.style.textShadow = '2px 2px 8px rgba(0,0,0,0.7)';
textoPausado.style.display = 'none';
textoPausado.style.zIndex = '1001'; // Encima de todo
document.body.appendChild(textoPausado);

document.body.appendChild(pausaMenu);

function pausarJuego() {
    juegoPausado = true;
    overlay.style.display = 'block';
    overlay.style.opacity = '1';
    pausaMenu.style.display = 'block';
    textoPausado.style.display = 'block';

    document.exitPointerLock();

    // Pausar superpoder
    if (superpoderActivo && !superpoderEnPausa) {
        clearInterval(intervaloSuperpoder);
        clearTimeout(superpoderTimeout);

        // Calcular cuánto tiempo queda
        const ahora = Date.now();
        const transcurrido = Math.floor((ahora - inicioSuperpoderTimestamp) / 1000);
        tiempoRestanteSuperpoder = Math.max(1, tiempoRestanteSuperpoder - transcurrido); // Nunca menos de 1

        superpoderEnPausa = true;
    }
}

function reanudarJuego() {
    juegoPausado = false;
    overlay.style.opacity = '0';
    overlay.style.display = 'none';
    pausaMenu.style.display = 'none';
    textoPausado.style.display = 'none';

    document.body.requestPointerLock();

    // Reanudar superpoder si estaba activo
    if (superpoderActivo && superpoderEnPausa) {
        superpoderIndicator.style.display = 'block';
        superpoderIndicator.textContent = `Superpoder\nTiempo: ${tiempoRestanteSuperpoder}s`;

        inicioSuperpoderTimestamp = Date.now();

        intervaloSuperpoder = setInterval(() => {
            tiempoRestanteSuperpoder--;
            superpoderIndicator.textContent = `Superpoder\nTiempo: ${tiempoRestanteSuperpoder}s`;

            if (tiempoRestanteSuperpoder <= 0) {
                clearInterval(intervaloSuperpoder);
                superpoderIndicator.style.display = 'none';
            }
        }, 1000);

        superpoderTimeout = setTimeout(() => {
            finalizarSuperpoder();
        }, tiempoRestanteSuperpoder * 1000);

        superpoderEnPausa = false;
    }
}
*/

function desactivarBomba(bomba) {
    if (bombaDesactivada.has(bomba)) return;

    bombaDesactivada.add(bomba);

    mensajeBombaDesactivadaActivo = true;

    actualizarVRMensaje('¡BOMBA DESACTIVADA!');
    vrMensajeSprite.position.set(0, -0.8, -2);

    tiempoRestante += 60;

    setTimeout(() => {
        vrMensajeSprite.position.set(0, -5, 0);
        mensajeBombaDesactivadaActivo = false;
    }, 2000);

}

function actualizarVRSuperpoder(texto) {
    const canvas = vrSuperpoderSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'cyan';
    ctx.font = '38px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(texto, canvas.width / 2, 80);

    vrSuperpoderSprite.material.map.needsUpdate = true;
}

function mostrarVRMensajeSuperpoder(texto) {
    const canvas = vrMensajeSuperpoderSprite.material.map.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'yellow';
    ctx.font = '42px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(texto, canvas.width / 2, 80);

    vrMensajeSuperpoderSprite.material.map.needsUpdate = true;
    vrMensajeSuperpoderSprite.visible = true;

    setTimeout(() => {
        vrMensajeSuperpoderSprite.visible = false;
    }, 2000);
}

loader.load('Cubo.glb', (gltf) => {
    const modelo = gltf.scene;

    // Clon 1
    const clon1 = modelo.clone();
    clon1.position.set(37, 3.2, -13);
    clon1.scale.set(3, 3, 3);

    // Clon 2
    const clon2 = modelo.clone();
    clon2.position.set(12.2, 3.2, 0);
    clon2.scale.set(3, 3, 3);

    // Clon 3
    const clon3 = modelo.clone();
    clon3.position.set(-27, 3.2, -20);
    clon3.scale.set(3, 3, 3);

    // Clon 4
    const clon4 = modelo.clone();
    clon4.position.set(-20, 3.2, 0);
    clon4.scale.set(3, 3, 3);

    // Clon 5
    const clon5 = modelo.clone();
    clon5.position.set(0, 3.2, 25);
    clon5.scale.set(3, 3, 3);

    scene.add(clon1, clon2, clon3, clon4, clon5);
    cubosSuperpoder.push(clon1, clon2, clon3, clon4, clon5);

});

const cubosSuperpoder = []; // <- Guardaremos los clones del Cubo.glb aquí

let superpoderActivo = false;
let superpoderTimeout = null;

let tiempoRestanteSuperpoder = 0;
let intervaloSuperpoder = null;
let superpoderEnPausa = false;
let tiempoRestanteTimeoutSuperpoder = 0;
let inicioSuperpoderTimestamp = 0;

function activarSuperpoder() {
    if (superpoderActivo) return; // No acumular poderes

    superpoderActivo = true;

    // Elegir superpoder aleatorio
    const poderes = ['salto', 'velocidad'];
    const poder = poderes[Math.floor(Math.random() * poderes.length)];

    // Mostrar mensaje
    mostrarMensajeSuperpoder(poder);

    // Aplicar superpoder
    if (poder === 'salto') {
        playerVelocity.y += 20;  // Un impulso inicial opcional
        GRAVITY_SUPLEMENTO = -30; // Menos gravedad para saltar más alto (temporalmente)
    } else if (poder === 'velocidad') {
        SPEED_MULTIPLIER = 2.0;  // Moverse al doble de velocidad (temporalmente)
    }

    tiempoRestanteSuperpoder = 15;
    vrSuperpoderSprite.visible = true;
    actualizarVRSuperpoder(`Superpoder: ${poder}\nTiempo: ${tiempoRestanteSuperpoder}s`);

    // Guarda el timestamp de inicio
    inicioSuperpoderTimestamp = Date.now();

    intervaloSuperpoder = setInterval(() => {
        tiempoRestanteSuperpoder--;
        actualizarVRSuperpoder(`Superpoder: ${poder}\nTiempo: ${tiempoRestanteSuperpoder}s`);

        // Seguridad extra: si llega a 0 manualmente
        if (tiempoRestanteSuperpoder <= 0) {
            clearInterval(intervaloSuperpoder);
            superpoderIndicator.style.display = 'none';
        }
    }, 1000);

    superpoderTimeout = setTimeout(() => {
        finalizarSuperpoder();
    }, tiempoRestanteSuperpoder * 1000);

    // Quitar superpoder después de 10 segundos
    superpoderTimeout = setTimeout(() => {
        superpoderActivo = false;
        GRAVITY_SUPLEMENTO = 0;
        SPEED_MULTIPLIER = 1.0;

        clearInterval(intervaloSuperpoder);
        superpoderIndicator.style.display = 'none';

        ocultarMensajeSuperpoder();
    }, 15000);
}

function mostrarMensajeSuperpoder(poder) {
    if (poder === 'salto') {
        mostrarVRMensajeSuperpoder('¡Super Salto Activado!');
    } else if (poder === 'velocidad') {
        mostrarVRMensajeSuperpoder('¡Super Velocidad Activada!');
    }

    // Ocultar automáticamente después de 2 segundos
    setTimeout(() => {
        mensajeSuperpoder.style.display = 'none';
    }, 2000);
}

function ocultarMensajeSuperpoder() {
    mensajeSuperpoder.style.display = 'none';
}

function finalizarSuperpoder() {
    superpoderActivo = false;
    GRAVITY_SUPLEMENTO = 0;
    SPEED_MULTIPLIER = 1.0;

    clearInterval(intervaloSuperpoder);
    vrSuperpoderSprite.visible = false;
    ocultarMensajeSuperpoder();
}

/*
function mostrarPantallaDerrota() {
    // Salir del PointerLock si estaba activo
    document.exitPointerLock();

    // Fondo oscuro translúcido
    const fondoOscuro = document.createElement('div');
    fondoOscuro.style.position = 'fixed';
    fondoOscuro.style.top = '0';
    fondoOscuro.style.left = '0';
    fondoOscuro.style.width = '100%';
    fondoOscuro.style.height = '100%';
    fondoOscuro.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    fondoOscuro.style.zIndex = '1001';
    fondoOscuro.style.transition = 'opacity 0.5s';
    fondoOscuro.style.opacity = '0';
    document.body.appendChild(fondoOscuro);

    // Contenedor del mensaje
    const derrotaOverlay = document.createElement('div');
    derrotaOverlay.style.position = 'fixed';
    derrotaOverlay.style.top = '50%';
    derrotaOverlay.style.left = '50%';
    derrotaOverlay.style.transform = 'translate(-50%, -50%)';
    derrotaOverlay.style.backgroundColor = 'rgba(0,0,0,0.9)';
    derrotaOverlay.style.padding = '40px 60px';
    derrotaOverlay.style.borderRadius = '12px';
    derrotaOverlay.style.color = 'white';
    derrotaOverlay.style.fontFamily = 'Arial';
    derrotaOverlay.style.fontSize = '32px';
    derrotaOverlay.style.fontWeight = 'bold';
    derrotaOverlay.style.textAlign = 'center';
    derrotaOverlay.style.zIndex = '1002';
    derrotaOverlay.style.opacity = '0';
    derrotaOverlay.style.transition = 'opacity 0.5s';

    derrotaOverlay.innerHTML = `😞 <br> ¡Has perdido! <br><br> El tiempo se ha agotado.<br><br>`;

    // Botones
    const botonesContainer = document.createElement('div');
    botonesContainer.className = 'd-flex justify-content-center gap-3 mt-3';

    const botonReintentar = document.createElement('button');
    botonReintentar.textContent = 'Reintentar';
    botonReintentar.className = 'btn btn-primary btn-lg';
    botonReintentar.onclick = () => location.reload();

    const botonSalir = document.createElement('button');
    botonSalir.textContent = 'Salir';
    botonSalir.className = 'btn btn-danger btn-lg';
    botonSalir.onclick = () => location.href = 'index.html';

    botonesContainer.appendChild(botonReintentar);
    botonesContainer.appendChild(botonSalir);
    derrotaOverlay.appendChild(botonesContainer);

    document.body.appendChild(derrotaOverlay);

    // Animación de fade-in
    requestAnimationFrame(() => {
        fondoOscuro.style.opacity = '1';
        derrotaOverlay.style.opacity = '1';
    });
}
*/

function mostrarPantallaDerrota() {
    vrPantallaDerrotaSprite.visible = true;

    setTimeout(() => {
        location.reload();
    }, 6000);
}

function mostrarPantallaVictoria() {
    vrPantallaVictoriaSprite.visible = true;

    setTimeout(() => {
        location.reload();
    }, 6000);
}