import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const CONFIG_FILE = path.join(__dirname, 'viewer-config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Initialize config if not exists
if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ active: null }, null, 2));
}

function readConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function writeConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Validate uploaded filenames to prevent path traversal
function isValidFilename(filename) {
    const basename = path.basename(filename);
    return basename === filename && !filename.includes('..') && /^[\w\-. ]+$/.test(filename);
}

const app = express();
app.use(express.json());

// Multer config: accept .ply and .json files
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        // Use original filename, sanitized
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._\-]/g, '_');
        cb(null, safeName);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.ply', '.json'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only .ply and .json files are allowed'));
        }
    },
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

// --- API Routes ---

// List uploaded files
app.get('/api/files', (req, res) => {
    const files = fs.readdirSync(UPLOADS_DIR).map(name => {
        const stat = fs.statSync(path.join(UPLOADS_DIR, name));
        return {
            name,
            size: stat.size,
            mtime: stat.mtime
        };
    });
    const config = readConfig();
    res.json({ files, active: config.active });
});

// Upload files (multiple)
app.post('/api/upload', upload.array('files', 20), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
    }
    const uploaded = req.files.map(f => ({
        name: f.filename,
        size: f.size
    }));
    res.json({ success: true, files: uploaded });
});

// Delete a file
app.delete('/api/files/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!isValidFilename(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    fs.unlinkSync(filePath);

    // If deleted file was active, clear config
    const config = readConfig();
    if (config.active) {
        if (config.active.ply === filename || config.active.settings === filename) {
            config.active = null;
            writeConfig(config);
        }
    }
    res.json({ success: true });
});

// Set active render configuration
app.post('/api/config', (req, res) => {
    const { ply, settings } = req.body;
    if (!ply) {
        return res.status(400).json({ error: 'ply filename is required' });
    }
    // Validate files exist
    if (!fs.existsSync(path.join(UPLOADS_DIR, ply))) {
        return res.status(400).json({ error: `PLY file "${ply}" not found in uploads` });
    }
    if (settings && !fs.existsSync(path.join(UPLOADS_DIR, settings))) {
        return res.status(400).json({ error: `Settings file "${settings}" not found in uploads` });
    }
    const config = readConfig();
    config.active = { ply, settings: settings || null };
    writeConfig(config);
    res.json({ success: true, active: config.active });
});

// Clear active configuration
app.post('/api/config/clear', (req, res) => {
    const config = readConfig();
    config.active = null;
    writeConfig(config);
    res.json({ success: true });
});

// Get current config
app.get('/api/config', (req, res) => {
    const config = readConfig();
    res.json(config);
});

// --- Serve uploaded files ---
app.use('/uploads', express.static(UPLOADS_DIR));

// --- Serve admin page ---
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// --- Serve viewer (public dir) with dynamic content/settings ---
// Redirect root to viewer with configured content if available
app.get('/', (req, res, next) => {
    // If query params already specified, serve static viewer
    if (req.query.content || req.query.settings) {
        return next();
    }
    const config = readConfig();
    if (config.active && config.active.ply) {
        const params = new URLSearchParams();
        params.set('content', `/uploads/${config.active.ply}`);
        if (config.active.settings) {
            params.set('settings', `/uploads/${config.active.settings}`);
        }
        return res.redirect(`/?${params.toString()}`);
    }
    next();
});

app.use(express.static(PUBLIC_DIR));

// Error handling for multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
    }
    if (err) {
        return res.status(400).json({ error: err.message });
    }
    next();
});

app.listen(PORT, () => {
    console.log(`SuperSplat Viewer Server running on http://localhost:${PORT}`);
    console.log(`  Viewer:  http://localhost:${PORT}/`);
    console.log(`  Admin:   http://localhost:${PORT}/admin`);
    console.log(`  Uploads: ${UPLOADS_DIR}`);
});
