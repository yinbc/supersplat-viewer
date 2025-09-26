import '@playcanvas/web-components';
import { Asset, Color, Entity, EventHandler, MiniStats, Quat, ShaderChunks, Vec3 } from 'playcanvas';
import { XrControllers } from 'playcanvas/scripts/esm/xr-controllers.mjs';
import { XrNavigation } from 'playcanvas/scripts/esm/xr-navigation.mjs';

import { migrateSettings } from './data-migrations.js';
import { observe } from './observe.js';
import { Viewer } from './viewer.js';

/** @import { AppElement, EntityElement } from '@playcanvas/web-components' */
/** @import { Texture } from 'playcanvas' */

// override global pick to pack depth instead of meshInstance id
const pickDepthGlsl = /* glsl */ `
vec4 packFloat(float depth) {
    uvec4 u = (uvec4(floatBitsToUint(depth)) >> uvec4(0u, 8u, 16u, 24u)) & 0xffu;
    return vec4(u) / 255.0;
}
vec4 getPickOutput() {
    return packFloat(gl_FragCoord.z);
}
`;

const pickDepthWgsl = /* wgsl */ `
    fn packFloat(depth: f32) -> vec4f {
        let u: vec4<u32> = (vec4<u32>(bitcast<u32>(depth)) >> vec4<u32>(0u, 8u, 16u, 24u)) & vec4<u32>(0xffu);
        return vec4f(u) / 255.0;
    }

    fn getPickOutput() -> vec4f {
        return packFloat(pcPosition.z);
    }
`;

// temporary vector
const v = new Vec3();

// get experience parameters
const params = window.sse?.params ?? {};

// displays a blurry poster image which resolves to sharp during loading
const initPoster = (events) => {
    const element = document.getElementById('poster');
    const blur = progress => `blur(${Math.floor((100 - progress) * 0.4)}px)`;

    events.on('progress:changed', (progress) => {
        element.style.filter = blur(progress);
    });

    events.on('firstFrame', () => {
        element.style.display = 'none';
    });
};

// On entering/exiting AR, we need to set the camera clear color to transparent black
const initXr = (app, cameraElement, state, events) => {

    // initialize ar/vr
    app.xr.on('available:immersive-ar', (available) => {
        state.hasAR = available;
    });
    app.xr.on('available:immersive-vr', (available) => {
        state.hasVR = available;
    });

    const parent = cameraElement.parentElement.entity;
    const camera = cameraElement.entity;
    const clearColor = new Color();

    const parentPosition = new Vec3();
    const parentRotation = new Quat();
    const cameraPosition = new Vec3();
    const cameraRotation = new Quat();
    const angles = new Vec3();

    parent.script.create(XrControllers);
    parent.script.create(XrNavigation);

    app.xr.on('start', () => {
        app.autoRender = true;

        // cache original camera rig positions and rotations
        parentPosition.copy(parent.getPosition());
        parentRotation.copy(parent.getRotation());
        cameraPosition.copy(camera.getPosition());
        cameraRotation.copy(camera.getRotation());

        cameraRotation.getEulerAngles(angles);

        // copy transform to parent to XR/VR mode starts in the right place
        parent.setPosition(cameraPosition.x, 0, cameraPosition.z);
        parent.setEulerAngles(0, angles.y, 0);

        if (app.xr.type === 'immersive-ar') {
            clearColor.copy(camera.camera.clearColor);
            camera.camera.clearColor = new Color(0, 0, 0, 0);
        }
    });

    app.xr.on('end', () => {
        app.autoRender = false;

        // restore camera to pre-XR state
        parent.setPosition(parentPosition);
        parent.setRotation(parentRotation);
        camera.setPosition(cameraPosition);
        camera.setRotation(cameraRotation);

        if (app.xr.type === 'immersive-ar') {
            camera.camera.clearColor = clearColor;
        }
    });

    events.on('startAR', () => {
        app.xr.start(app.root.findComponent('camera'), 'immersive-ar', 'local-floor');
    });

    events.on('startVR', () => {
        app.xr.start(app.root.findComponent('camera'), 'immersive-vr', 'local-floor');
    });

    events.on('inputEvent', (event) => {
        if (event === 'cancel' && app.xr.active) {
            app.xr.end();
        }
    });
};

const loadContent = (app) => {
    const { contentEntries, contentUrl, contents } = window.sse;
    const entries = (contentEntries && contentEntries.length > 0) ? contentEntries : [{ url: contentUrl, contents }];

    const assets = entries.map((entry, index) => {
        const filename = new URL(entry.url, location.href).pathname.split('/').pop();
        const baseName = filename && filename.length > 0 ? filename : 'gsplat';
        const uniqueName = `${baseName}-${index}`;

        const asset = new Asset(uniqueName, 'gsplat', {
            url: entry.url,
            filename: baseName,
            contents: entry.contents
        });

        asset.on('error', (err) => {
            console.log(err);
        });

        app.assets.add(asset);
        app.assets.load(asset);
        return asset;
    });

    if (assets.length === 0) {
        return;
    }

    const entity = new Entity('gsplat');
    entity.setLocalEulerAngles(0, 0, 180);

    let currentIndex = -1;
    let frameCounter = 0;

    const setAsset = (index) => {
        const asset = assets[index];
        if (!asset || !asset.loaded) {
            return false;
        }

        if (!entity.gsplat) {
            entity.addComponent('gsplat', { asset });
            app.root.addChild(entity);
        } else if (entity.gsplat.asset !== asset) {
            entity.gsplat.asset = asset;
        }

        entity.gsplat.instance?.sort(entity);

        currentIndex = index;
        app.renderNextFrame = true;
        return true;
    };

    assets.forEach((asset, index) => {
        asset.on('load', () => {
            if (index === 0) {
                setAsset(0);
                return;
            }

            if (currentIndex === -1) {
                setAsset(index);
            }
        });
    });

    app.on('frameend', () => {
        if (!entity.gsplat || assets.length < 2) {
            return;
        }

        frameCounter += 1;
        if (frameCounter % 10 !== 0) {
            return;
        }

        for (let step = 1; step < assets.length; step++) {
            const nextIndex = (currentIndex + step) % assets.length;
            if (assets[nextIndex].loaded) {
                setAsset(nextIndex);
                break;
            }
        }
    });
};

const waitForGsplat = (app, state) => {
    return new Promise((resolve) => {
        const assets = app.assets.filter(asset => asset.type === 'gsplat');
        if (assets.length > 0) {
            const asset = assets[0];

            let watermark = 0;

            asset.on('progress', (received, length) => {
                const progress = Math.min(1, received / length) * 100;
                if (progress > watermark) {
                    watermark = progress;
                    state.progress = watermark.toFixed(0);
                }
            });

            if (asset.loaded) {
                resolve(asset);
            } else {
                asset.on('load', () => {
                    resolve(asset);
                });
            }
        }
    });
};

document.addEventListener('DOMContentLoaded', async () => {
    const appElement = /** @type {AppElement} */ (document.querySelector('pc-app'));
    const app = (await appElement.ready()).app;
    const { graphicsDevice } = app;

    // enable anonymous CORS for image loading in safari
    app.loader.getHandler('texture').imgParser.crossOrigin = 'anonymous';

    // render skybox as plain equirect
    const glsl = ShaderChunks.get(graphicsDevice, 'glsl');
    glsl.set('skyboxPS', glsl.get('skyboxPS').replace('mapRoughnessUv(uv, mipLevel)', 'uv'));
    glsl.set('pickPS', pickDepthGlsl);

    const wgsl = ShaderChunks.get(graphicsDevice, 'wgsl');
    wgsl.set('skyboxPS', wgsl.get('skyboxPS').replace('mapRoughnessUv(uv, uniform.mipLevel)', 'uv'));
    wgsl.set('pickPS', pickDepthWgsl);

    loadContent(app);

    const cameraElement = await /** @type {EntityElement} */ (document.querySelector('pc-entity[name="camera"]')).ready();
    const camera = cameraElement.entity;
    const settings = migrateSettings(await window.sse?.settings);
    const events = new EventHandler();
    const state = observe(events, {
        readyToRender: false,       // don't render till this is set
        hqMode: true,
        progress: 0,
        inputMode: 'desktop',       // desktop, touch
        cameraMode: 'orbit',        // orbit, anim, fly
        snap: false,                // snap to camera target
        hasAnimation: false,
        animationDuration: 0,
        animationTime: 0,
        animationPaused: params.noanim,
        hasAR: app.xr.isAvailable('immersive-ar'),
        hasVR: app.xr.isAvailable('immersive-vr'),
        isFullscreen: false,
        uiVisible: true
    });

    // Initialize the load-time poster
    if (window.sse?.poster) {
        initPoster(events);
    }

    // Initialize skybox
    if (params.skyboxUrl) {
        const skyAsset = new Asset('skybox', 'texture', {
            url: params.skyboxUrl
        }, {
            type: 'rgbp',
            mipmaps: false,
            addressu: 'repeat',
            addressv: 'clamp'
        });

        skyAsset.on('load', () => {
            app.scene.envAtlas = /** @type {Texture} */ (skyAsset.resource);
        });

        app.assets.add(skyAsset);
        app.assets.load(skyAsset);
    }

    // Construct ministats
    if (params.ministats) {
        // eslint-disable-next-line no-new
        new MiniStats(app);
    }

    // Initialize XR support
    initXr(app, cameraElement, state, events);

    // Initialize viewer
    const viewer = new Viewer(app, camera, events, state, settings, params);

    // Wait for gsplat asset to load before initializing the viewer
    waitForGsplat(app, state).then(() => viewer.initialize());

    // Acquire Elements
    const docRoot = document.documentElement;
    const dom = [
        'ui',
        'controlsWrap',
        'arMode', 'vrMode',
        'enterFullscreen', 'exitFullscreen',
        'info', 'infoPanel', 'desktopTab', 'touchTab', 'desktopInfoPanel', 'touchInfoPanel',
        'timelineContainer', 'handle', 'time',
        'buttonContainer',
        'play', 'pause',
        'settings', 'settingsPanel',
        'orbitSettings', 'flySettings',
        'fly', 'orbit', 'cameraToggleHighlight',
        'high', 'low', 'qualityToggleHighlight',
        'reset', 'frame',
        'loadingText', 'loadingBar',
        'joystickBase', 'joystick'
    ].reduce((acc, id) => {
        acc[id] = document.getElementById(id);
        return acc;
    }, /** @type {Record<string, HTMLElement>} */ ({}));

    // Handle loading progress updates
    events.on('progress:changed', (progress) => {
        dom.loadingText.textContent = `${progress}%`;
        if (progress < 100) {
            dom.loadingBar.style.backgroundImage = `linear-gradient(90deg, #F60 0%, #F60 ${progress}%, white ${progress}%, white 100%)`;
        } else {
            dom.loadingBar.style.backgroundImage = 'linear-gradient(90deg, #F60 0%, #F60 100%)';
        }
    });

    // Hide loading bar once first frame is rendered
    events.on('firstFrame', () => {
        document.getElementById('loadingWrap').classList.add('hidden');
    });

    // Fullscreen support
    const hasFullscreenAPI = docRoot.requestFullscreen && document.exitFullscreen;

    const requestFullscreen = () => {
        if (hasFullscreenAPI) {
            docRoot.requestFullscreen();
        } else {
            window.parent.postMessage('requestFullscreen', '*');
            state.isFullscreen = true;
        }
    };

    const exitFullscreen = () => {
        if (hasFullscreenAPI) {
            document.exitFullscreen();
        } else {
            window.parent.postMessage('exitFullscreen', '*');
            state.isFullscreen = false;
        }
    };

    if (hasFullscreenAPI) {
        document.addEventListener('fullscreenchange', () => {
            state.isFullscreen = !!document.fullscreenElement;
        });
    }

    dom.enterFullscreen.addEventListener('click', requestFullscreen);
    dom.exitFullscreen.addEventListener('click', exitFullscreen);

    // toggle fullscreen when user switches between landscape portrait
    // orientation
    screen?.orientation?.addEventListener('change', (event) => {
        if (['landscape-primary', 'landscape-secondary'].includes(screen.orientation.type)) {
            requestFullscreen();
        } else {
            exitFullscreen();
        }
    });

    // update UI when fullscreen state changes
    events.on('isFullscreen:changed', (value) => {
        dom.enterFullscreen.classList[value ? 'add' : 'remove']('hidden');
        dom.exitFullscreen.classList[value ? 'remove' : 'add']('hidden');
    });

    // HQ mode
    dom.high.addEventListener('click', () => {
        state.hqMode = true;
    });
    dom.low.addEventListener('click', () => {
        state.hqMode = false;
    });

    const updateHQ = () => {
        dom.qualityToggleHighlight.classList[state.hqMode ? 'add' : 'remove']('right');
    };
    events.on('hqMode:changed', (value) => {
        updateHQ();
    });
    updateHQ();

    // AR/VR
    const arChanged = () => dom.arMode.classList[state.hasAR ? 'remove' : 'add']('hidden');
    const vrChanged = () => dom.vrMode.classList[state.hasVR ? 'remove' : 'add']('hidden');

    dom.arMode.addEventListener('click', () => events.fire('startAR'));
    dom.vrMode.addEventListener('click', () => events.fire('startVR'));

    events.on('hasAR:changed', arChanged);
    events.on('hasVR:changed', vrChanged);

    arChanged();
    vrChanged();

    // Info panel
    const updateInfoTab = (tab) => {
        if (tab === 'desktop') {
            dom.desktopTab.classList.add('active');
            dom.touchTab.classList.remove('active');
            dom.desktopInfoPanel.classList.remove('hidden');
            dom.touchInfoPanel.classList.add('hidden');
        } else {
            dom.desktopTab.classList.remove('active');
            dom.touchTab.classList.add('active');
            dom.desktopInfoPanel.classList.add('hidden');
            dom.touchInfoPanel.classList.remove('hidden');
        }
    };

    dom.desktopTab.addEventListener('click', () => {
        updateInfoTab('desktop');
    });

    dom.touchTab.addEventListener('click', () => {
        updateInfoTab('touch');
    });

    dom.info.addEventListener('pointerup', () => {
        updateInfoTab(state.inputMode);
        dom.infoPanel.classList.toggle('hidden');
    });

    dom.infoPanel.addEventListener('pointerdown', () => {
        dom.infoPanel.classList.add('hidden');
    });

    events.on('inputEvent', (event) => {
        if (event === 'cancel') {
            // close info panel on cancel
            dom.infoPanel.classList.add('hidden');
            dom.settingsPanel.classList.add('hidden');

            // close fullscreen on cancel
            if (state.isFullscreen) {
                exitFullscreen();
            }
        } else if (event === 'interrupt') {
            dom.settingsPanel.classList.add('hidden');
        }
    });

    // fade ui controls after 5 seconds of inactivity
    events.on('uiVisible:changed', (value) => {
        dom.controlsWrap.className = value ? 'faded-in' : 'faded-out';
    });

    // show the ui and start a timer to hide it again
    let uiTimeout = null;
    const showUI = () => {
        if (uiTimeout) {
            clearTimeout(uiTimeout);
        }
        state.uiVisible = true;
        uiTimeout = setTimeout(() => {
            uiTimeout = null;
            state.uiVisible = false;
        }, 4000);
    };
    showUI();

    events.on('inputEvent', showUI);

    // Animation controls
    events.on('hasAnimation:changed', (value, prev) => {
        // Start and Stop animation
        dom.play.addEventListener('click', () => {
            state.cameraMode = 'anim';
            state.animationPaused = false;
        });

        dom.pause.addEventListener('click', () => {
            state.cameraMode = 'anim';
            state.animationPaused = true;
        });

        const updatePlayPause = () => {
            if (state.cameraMode !== 'anim' || state.animationPaused) {
                dom.play.classList.remove('hidden');
                dom.pause.classList.add('hidden');
            } else {
                dom.play.classList.add('hidden');
                dom.pause.classList.remove('hidden');
            }

            if (state.cameraMode === 'anim') {
                dom.timelineContainer.classList.remove('hidden');
            } else {
                dom.timelineContainer.classList.add('hidden');
            }
        };

        // Update UI on animation changes
        events.on('cameraMode:changed', updatePlayPause);
        events.on('animationPaused:changed', updatePlayPause);

        // Spacebar to play/pause
        events.on('inputEvent', (eventName) => {
            if (eventName === 'playPause') {
                state.cameraMode = 'anim';
                state.animationPaused = !state.animationPaused;
            }
        });

        const updateSlider = () => {
            dom.handle.style.left = `${state.animationTime / state.animationDuration * 100}%`;
            dom.time.style.left = `${state.animationTime / state.animationDuration * 100}%`;
            dom.time.innerText = `${state.animationTime.toFixed(1)}s`;
        };

        events.on('animationTime:changed', updateSlider);
        events.on('animationLength:changed', updateSlider);

        const handleScrub = (event) => {
            const rect = dom.timelineContainer.getBoundingClientRect();
            const t = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left)) / rect.width;
            events.fire('setAnimationTime', state.animationDuration * t);
        };

        let paused = false;
        let captured = false;

        dom.timelineContainer.addEventListener('pointerdown', (event) => {
            if (!captured) {
                handleScrub(event);
                dom.timelineContainer.setPointerCapture(event.pointerId);
                dom.time.classList.remove('hidden');
                paused = state.animationPaused;
                state.animationPaused = true;
                captured = true;
            }
        });

        dom.timelineContainer.addEventListener('pointermove', (event) => {
            if (captured) {
                handleScrub(event);
            }
        });

        dom.timelineContainer.addEventListener('pointerup', (event) => {
            if (captured) {
                dom.timelineContainer.releasePointerCapture(event.pointerId);
                dom.time.classList.add('hidden');
                state.animationPaused = paused;
                captured = false;
            }
        });
    });

    // Camera mode UI
    events.on('cameraMode:changed', () => {
        if (state.cameraMode === 'fly') {
            dom.cameraToggleHighlight.classList.add('right');
        } else {
            dom.cameraToggleHighlight.classList.remove('right');
        }

        dom.orbitSettings.classList[state.cameraMode === 'orbit' ? 'remove' : 'add']('hidden');
        dom.flySettings.classList[state.cameraMode === 'fly' ? 'remove' : 'add']('hidden');
    });

    dom.orbitSettings.addEventListener('click', () => {
        dom.settingsPanel.classList.toggle('hidden');
    });

    dom.flySettings.addEventListener('click', () => {
        dom.settingsPanel.classList.toggle('hidden');
    });

    dom.fly.addEventListener('click', () => {
        state.cameraMode = 'fly';
    });

    dom.orbit.addEventListener('click', () => {
        state.cameraMode = 'orbit';
    });

    dom.reset.addEventListener('click', (event) => {
        events.fire('inputEvent', 'reset', event);
    });

    dom.frame.addEventListener('click', (event) => {
        events.fire('inputEvent', 'frame', event);
    });

    // update UI based on touch joystick updates
    events.on('touchJoystickUpdate', (base, stick) => {
        if (base === null) {
            dom.joystickBase.classList.add('hidden');
        } else {
            v.set(stick[0], stick[1], 0).mulScalar(1 / 48);
            if (v.length() > 1) {
                v.normalize();
            }
            v.mulScalar(48);

            dom.joystickBase.classList.remove('hidden');
            dom.joystickBase.style.left = `${base[0]}px`;
            dom.joystickBase.style.top = `${base[1]}px`;
            dom.joystick.style.left = `${48 + v.x}px`;
            dom.joystick.style.top = `${48 + v.y}px`;
        }
    });

    // Hide UI
    if (params.noui) {
        dom.ui.classList.add('hidden');
    }

    // Generate input events

    ['wheel', 'pointerdown', 'contextmenu', 'keydown'].forEach((eventName) => {
        graphicsDevice.canvas.addEventListener(eventName, (event) => {
            events.fire('inputEvent', 'interrupt', event);
        });
    });

    graphicsDevice.canvas.addEventListener('pointermove', (event) => {
        events.fire('inputEvent', 'interact', event);
    });

    // we must detect double taps manually because ios doesn't send dblclick events
    const lastTap = { time: 0, x: 0, y: 0 };
    graphicsDevice.canvas.addEventListener('pointerdown', (event) => {
        const now = Date.now();
        const delay = Math.max(0, now - lastTap.time);
        if (delay < 300 &&
            Math.abs(event.clientX - lastTap.x) < 8 &&
            Math.abs(event.clientY - lastTap.y) < 8) {
            events.fire('inputEvent', 'dblclick', event);
            lastTap.time = 0;
        } else {
            lastTap.time = now;
            lastTap.x = event.clientX;
            lastTap.y = event.clientY;
        }
    });

    // update input mode based on pointer event
    ['pointerdown', 'pointermove'].forEach((eventName) => {
        window.addEventListener(eventName, (/** @type {PointerEvent} */ event) => {
            state.inputMode = event.pointerType === 'touch' ? 'touch' : 'desktop';
        });
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            events.fire('inputEvent', 'cancel', event);
        } else if (!event.ctrlKey && !event.altKey && !event.metaKey) {
            switch (event.key) {
                case 'f':
                    events.fire('inputEvent', 'frame', event);
                    break;
                case 'r':
                    events.fire('inputEvent', 'reset', event);
                    break;
                case ' ':
                    events.fire('inputEvent', 'playPause', event);
                    break;
            }
        }
    });
});
