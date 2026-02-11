const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Ensure downloads directory exists
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

// Serve downloads statically
app.use('/downloads', express.static(downloadsDir));

/**
 * Get video information using yt-dlp
 */
app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    console.log(`Fetching info for: ${url}`);

    const ytDlp = spawn('/home/admin-m/.local/bin/yt-dlp', [
        '--dump-json',
        '--flat-playlist',
        '--no-warnings',
        url
    ]);

    console.log('ytDlp:', ytDlp);

    let output = '';
    let errorOutput = '';

    ytDlp.stdout.on('data', (data) => output += data);
    ytDlp.stderr.on('data', (data) => errorOutput += data);

    ytDlp.on('close', (code) => {
        if (code !== 0) {
            console.error(`yt-dlp error: ${errorOutput}`);
            return res.status(500).json({ error: 'Failed to fetch video info', details: errorOutput });
        }

        try {
            const info = JSON.parse(output);

            console.log('info:', info);

            // Extract relevant info
            const result = {
                id: info.id,
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration,
                uploader: info.uploader,
                formats: info.formats
                    .filter(f => f.vcodec !== 'none' && f.acodec !== 'none') // Filter for combined formats
                    .map(f => ({
                        format_id: f.format_id,
                        ext: f.ext,
                        resolution: f.resolution || `${f.width}x${f.height}`,
                        filesize: f.filesize || f.filesize_approx,
                        quality: f.format_note || f.quality
                    }))
                    .sort((a, b) => (b.filesize || 0) - (a.filesize || 0)) // Sort by size/quality
            };

            console.log('result:', result);

            res.json(result);
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse video info' });
        }
    });
});

/**
 * Download and optionally trim video
 */
app.post('/api/download', (req, res) => {
    const { url, format_id, start_time, end_time } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const downloadId = uuidv4();
    const outputFileBase = `${downloadId}`;
    const outputFilePath = path.join(downloadsDir, `${outputFileBase}.%(ext)s`);

    console.log(`Starting download: ${url}, Format: ${format_id || 'best'}`);

    const args = [
        '-o', outputFilePath,
        '--no-playlist',
        '--newline'
    ];

    if (format_id) {
        args.push('-f', format_id);
    } else {
        args.push('-f', 'bestvideo+bestaudio/best');
    }

    const ytDlp = spawn('/home/admin-m/.local/bin/yt-dlp', [...args, url]);

    // Send the downloadId immediately so frontend can poll or use SSE
    res.json({ downloadId, status: 'started' });

    ytDlp.stdout.on('data', (data) => {
        const line = data.toString();
        // Progress parsing logic could be added here for SSE
        console.log(`[yt-dlp ${downloadId}]: ${line.trim()}`);
    });

    ytDlp.on('close', async (code) => {
        if (code === 0) {
            console.log(`Download completed: ${downloadId}`);

            // Find the actual file (yt-dlp handles extensions)
            const files = fs.readdirSync(downloadsDir);
            const downloadedFile = files.find(f => f.startsWith(downloadId));

            if (!downloadedFile) {
                console.error('Downloaded file not found');
                return;
            }

            const fullPath = path.join(downloadsDir, downloadedFile);

            // Check if trimming is needed
            if (start_time || end_time) {
                console.log(`Trimming video: ${downloadId} from ${start_time} to ${end_time}`);
                const trimmedFile = `${downloadId}_trimmed${path.extname(downloadedFile)}`;
                const trimmedPath = path.join(downloadsDir, trimmedFile);

                ffmpeg(fullPath)
                    .setStartTime(start_time || 0)
                    .setDuration((end_time || 999999) - (start_time || 0))
                    .output(trimmedPath)
                    .on('end', () => {
                        console.log('Trimming finished');
                        // Optional: delete original
                        // fs.unlinkSync(fullPath);
                    })
                    .on('error', (err) => {
                        console.error('Error trimming video:', err);
                    })
                    .run();
            }
        } else {
            console.error(`Download failed with code ${code}`);
        }
    });
});

/**
 * Get download status (Basic implementation)
 */
app.get('/api/status/:id', (req, res) => {
    const { id } = req.params;
    const files = fs.readdirSync(downloadsDir);
    const file = files.find(f => f.startsWith(id));

    if (file) {
        res.json({
            status: 'completed',
            url: `https://video-download-api.vercel.app/api/downloads/${file}`,
            filename: file
        });
    } else {
        res.json({ status: 'processing' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Premium Video Downloader API running on http://localhost:${PORT}`);
});
