import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folderName = req.body.folderName;
        if (!folderName || /[^a-zA-Z0-9_\-\u4e00-\u9fa5]/.test(folderName)) {
            return cb(new Error('Invalid folder name'));
        }
        const folderPath = path.join(UPLOADS_DIR, folderName);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        cb(null, folderPath);
    },
    filename: (req, file, cb) => {
        // Preserve original filename
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Serve static files from public directory (built viewer assets)
app.use(express.static(path.join(__dirname, 'public')));

// Serve static files from static directory (management page etc.)
app.use(express.static(path.join(__dirname, 'static')));

// Serve uploaded files
app.use('/uploads', express.static(UPLOADS_DIR));

// API: Upload files to a folder
app.post('/api/upload', upload.array('files'), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }

    const folderName = req.body.folderName;
    const uploadedFiles = req.files.map(f => ({
        name: f.originalname,
        size: f.size
    }));

    // Save upload metadata
    const metaPath = path.join(UPLOADS_DIR, folderName, '.upload-info.json');
    const meta = {
        folderName,
        uploadTime: new Date().toISOString(),
        files: uploadedFiles
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    res.json({ success: true, folder: folderName, files: uploadedFiles });
});

// API: List all uploaded folders with details
app.get('/api/folders', (req, res) => {
    if (!fs.existsSync(UPLOADS_DIR)) {
        return res.json([]);
    }

    const folders = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
            const folderPath = path.join(UPLOADS_DIR, d.name);
            const files = fs.readdirSync(folderPath)
                .filter(f => !f.startsWith('.'))
                .map(f => {
                    const stat = fs.statSync(path.join(folderPath, f));
                    return {
                        name: f,
                        size: stat.size,
                        mtime: stat.mtime.toISOString()
                    };
                });

            // Read upload info if available
            const metaPath = path.join(folderPath, '.upload-info.json');
            let uploadTime = null;
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
                    uploadTime = meta.uploadTime;
                } catch (e) {
                    // ignore
                }
            }

            const totalSize = files.reduce((sum, f) => sum + f.size, 0);

            return {
                name: d.name,
                uploadTime: uploadTime || files[0]?.mtime || null,
                totalSize,
                files
            };
        });

    res.json(folders);
});

// API: Delete a folder
app.delete('/api/folders/:name', (req, res) => {
    const folderName = req.params.name;
    const folderPath = path.join(UPLOADS_DIR, folderName);

    // Prevent path traversal
    if (folderName.includes('..') || folderName.includes('/')) {
        return res.status(400).json({ error: 'Invalid folder name' });
    }

    if (!fs.existsSync(folderPath)) {
        return res.status(404).json({ error: 'Folder not found' });
    }

    fs.rmSync(folderPath, { recursive: true, force: true });
    res.json({ success: true });
});

// Viewer route: /viewer?id=folderName
// This serves the viewer HTML with contentUrl and settingsUrl pointing to the uploaded folder
app.get('/viewer', (req, res) => {
    const folderId = req.query.id;
    if (!folderId) {
        return res.status(400).send('Missing id parameter. Usage: /viewer?id=folderName');
    }

    const folderPath = path.join(UPLOADS_DIR, folderId);
    if (!fs.existsSync(folderPath)) {
        return res.status(404).send('Folder not found: ' + folderId);
    }

    // Read the original index.html and inject the correct URLs
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    // Replace the default contentUrl and settingsUrl with paths to the uploaded folder
    const contentUrl = `/uploads/${encodeURIComponent(folderId)}/meta.json`;
    const settingsUrl = `/uploads/${encodeURIComponent(folderId)}/settings.json`;

    // Replace the default content/settings URLs in the inline script
    html = html.replace(
        "const settingsUrl = url.searchParams.has('settings') ? url.searchParams.get('settings') : './settings.json';",
        `const settingsUrl = url.searchParams.has('settings') ? url.searchParams.get('settings') : '${settingsUrl}';`
    );
    html = html.replace(
        "const contentUrl = url.searchParams.has('content') ? url.searchParams.get('content') : './scene.compressed.ply';",
        `const contentUrl = url.searchParams.has('content') ? url.searchParams.get('content') : '${contentUrl}';`
    );

    res.send(html);
});

app.listen(PORT, () => {
    console.log(`SuperSplat Viewer Server running at http://localhost:${PORT}`);
    console.log(`  Management page: http://localhost:${PORT}/manage.html`);
    console.log(`  Viewer: http://localhost:${PORT}/viewer?id=<folderName>`);
    console.log(`  Uploads directory: ${UPLOADS_DIR}`);
});
