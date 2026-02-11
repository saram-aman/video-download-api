const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Store download status
const downloads = new Map();

// Create downloads directory if it doesn't exist
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Serve static files from downloads directory
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Helper function to execute yt-dlp
function executeYtDlp(args) {
    return new Promise((resolve, reject) => {
        const ytDlp = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        ytDlp.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        ytDlp.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ytDlp.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || 'yt-dlp execution failed'));
            }
        });

        ytDlp.on('error', (err) => {
            reject(new Error(`Failed to start yt-dlp: ${err.message}. Make sure yt-dlp is installed.`));
        });
    });
}

// GET /api/info - Fetch video information
app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log(`Fetching info for: ${url}`);

        // Use yt-dlp to get video info in JSON format
        const args = [
            '--dump-json',
            '--no-playlist',
            url
        ];

        const output = await executeYtDlp(args);
        const videoData = JSON.parse(output);

        // Extract relevant information
        const formats = (videoData.formats || [])
            .filter(f => f.vcodec !== 'none' && f.acodec !== 'none') // Only formats with both video and audio
            .map(f => ({
                format_id: f.format_id,
                resolution: f.resolution || `${f.width}x${f.height}` || 'audio only',
                filesize: f.filesize || f.filesize_approx || 0,
                quality: f.format_note || f.quality || 'unknown',
                ext: f.ext || 'mp4'
            }))
            .slice(0, 10); // Limit to 10 formats

        // If no combined formats, add best video + audio format
        if (formats.length === 0) {
            formats.push({
                format_id: 'bestvideo+bestaudio/best',
                resolution: videoData.resolution || 'best',
                filesize: 0,
                quality: 'best',
                ext: videoData.ext || 'mp4'
            });
        }

        const info = {
            id: videoData.id,
            title: videoData.title,
            thumbnail: videoData.thumbnail,
            duration: videoData.duration || 0,
            uploader: videoData.uploader || videoData.channel || 'Unknown',
            formats: formats
        };

        res.json(info);
    } catch (error) {
        console.error('Error fetching video info:', error);
        res.status(500).json({
            error: 'Failed to fetch video information. Please check the URL and try again.',
            details: error.message
        });
    }
});

// POST /api/download - Download video
app.post('/api/download', async (req, res) => {
    try {
        const { url, format_id, start_time, end_time } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const downloadId = uuidv4();
        const filename = `video_${downloadId}.mp4`;
        const filepath = path.join(DOWNLOADS_DIR, filename);

        console.log(`Starting download: ${downloadId}`);

        // Initialize download status
        downloads.set(downloadId, {
            id: downloadId,
            status: 'processing',
            progress: 0,
            filename: filename,
            url: null
        });

        // Send immediate response
        res.json({ downloadId });

        // Build yt-dlp arguments
        const args = [
            '-f', format_id || 'bestvideo+bestaudio/best',
            '-o', filepath,
            '--no-playlist',
            '--merge-output-format', 'mp4'
        ];

        // Add video trimming if specified
        if (start_time !== undefined && end_time !== undefined) {
            args.push('--download-sections', `*${start_time}-${end_time}`);
            args.push('--force-keyframes-at-cuts');
        }

        args.push(url);

        // Execute download asynchronously
        executeYtDlp(args)
            .then(() => {
                console.log(`Download completed: ${downloadId}`);
                downloads.set(downloadId, {
                    id: downloadId,
                    status: 'completed',
                    progress: 100,
                    filename: filename,
                    url: `/downloads/${filename}`
                });

                // Schedule file cleanup after 1 hour
                setTimeout(() => {
                    try {
                        if (fs.existsSync(filepath)) {
                            fs.unlinkSync(filepath);
                            console.log(`Cleaned up file: ${filename}`);
                        }
                        downloads.delete(downloadId);
                    } catch (err) {
                        console.error(`Error cleaning up file: ${err.message}`);
                    }
                }, 3600000); // 1 hour
            })
            .catch((error) => {
                console.error(`Download failed: ${downloadId}`, error);
                downloads.set(downloadId, {
                    id: downloadId,
                    status: 'failed',
                    progress: 0,
                    error: error.message
                });

                // Clean up failed download after 5 minutes
                setTimeout(() => {
                    downloads.delete(downloadId);
                }, 300000);
            });

    } catch (error) {
        console.error('Error initiating download:', error);
        res.status(500).json({
            error: 'Failed to start download',
            details: error.message
        });
    }
});

// GET /api/status/:id - Check download status
app.get('/api/status/:id', (req, res) => {
    const { id } = req.params;
    const downloadStatus = downloads.get(id);

    if (!downloadStatus) {
        return res.status(404).json({ error: 'Download not found' });
    }

    res.json(downloadStatus);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Video downloader API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
    console.log(`🚀 Video downloader backend running on http://localhost:${PORT}`);
    console.log(`📁 Downloads directory: ${DOWNLOADS_DIR}`);
    console.log(`\nMake sure yt-dlp is installed:`);
    console.log(`  Windows: winget install yt-dlp`);
    console.log(`  Or: pip install yt-dlp\n`);
});
