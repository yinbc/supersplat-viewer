# SuperSplat Viewer

[![NPM Version](https://img.shields.io/npm/v/@playcanvas/supersplat-viewer)](https://www.npmjs.com/package/@playcanvas/supersplat-viewer)
[![NPM Downloads](https://img.shields.io/npm/dw/@playcanvas/supersplat-viewer)](https://npmtrends.com/@playcanvas/supersplat-viewer)
[![License](https://img.shields.io/npm/l/@playcanvas/supersplat-viewer)](https://github.com/playcanvas/supersplat-viewer/blob/main/LICENSE)
[![Discord](https://img.shields.io/badge/Discord-5865F2?style=flat&logo=discord&logoColor=white&color=black)](https://discord.gg/RSaMRzg)
[![Reddit](https://img.shields.io/badge/Reddit-FF4500?style=flat&logo=reddit&logoColor=white&color=black)](https://www.reddit.com/r/PlayCanvas)
[![X](https://img.shields.io/badge/X-000000?style=flat&logo=x&logoColor=white&color=black)](https://x.com/intent/follow?screen_name=playcanvas)

| [User Manual](https://developer.playcanvas.com/user-manual/gaussian-splatting/editing/supersplat/import-export/#html-viewer-htmlzip) | [Blog](https://blog.playcanvas.com) | [Forum](https://forum.playcanvas.com) |

This is the official viewer for https://superspl.at and the SuperSplat Editor HTML export.

<img width="1114" height="739" alt="supersplat-viewer" src="https://github.com/user-attachments/assets/15d2c654-9484-4265-a279-99acb65e38c9" />

This webapp compiles to simple, self-contained, static website.

The app supports a few useful URL parameters (though please note these are subject to change):
- `&settings=url` - specify the URL of the `settings.json` file (default is `./settings.json`)
- `&content=url` - specify the URL of the `scene.compressed.ply` file (default is `./scene.compressed.ply`)

As well as the following:
- `&noui` - hide UI
- `&noanim` - start with animation paused
- `&poster=url` - show an image while loading the scene content
- `&ministats` - show the runtime CPU (and on desktop, GPU) performance graphs
- `&skybox=url` - specify an equirectangular skybox image for the skybox

The webapp source files is available as strings for templating when imported as an NPM module:

```ts
import { html, css, js } from '@playcanvas/supersplat-viewer`;

// logs the source of index.html
console.log(html);

// logs the source of index.css
console.log(css);

// logs the source of index.js
console.log(js);
```

## Local Development

To initialize a local development environment for SuperSplat Viewer, ensure you have [Node.js](https://nodejs.org/) 18 or later installed. Follow these steps:

1. Clone the repository:

   ```sh
   git clone https://github.com/playcanvas/supersplat-viewer.git
   cd supersplat-viewer
   ```

2. Install dependencies:

   ```sh
   npm install
   ```

3. Build SuperSplat Viewer and start a local web server:

   ```sh
   npm run develop
   ```

4. Open the browser at http://localhost:3000.

## Settings Schema

The `settings.json` file has the following schema (as defined in typescript, taken from SuperSplat editor):


```typescript
type AnimTrack = {
    name: string,
    duration: number,
    frameRate: number,
    target: 'camera',
    loopMode: 'none' | 'repeat' | 'pingpong',
    interpolation: 'step' | 'spline',
    smoothness: number,
    keyframes: {
        times: number[],
        values: {
            position: number[],
            target: number[],
        }
    }
};

type ExperienceSettings = {
    camera: {
        fov?: number,
        position?: number[],
        target?: number[],
        startAnim: 'none' | 'orbit' | 'animTrack',
        animTrack: string
    },
    background: {
        color?: number[]
    },
    animTracks: AnimTrack[]
};
```

### Example settings.json

```json
{
  "background": {"color": [0,0,0,0]},
  "camera": {
    "fov": 1.0,
    "position": [0,1,-1],
    "target": [0,0,0],
    "startAnim": "orbit"
  }
}
```
