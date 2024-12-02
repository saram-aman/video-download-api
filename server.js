const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const cors = require('cors'); 
const app = express(); 
const PORT = 4000; 
app.use(cors()); 
app.use(express.json());
const agent = new https.Agent({
    rejectUnauthorized: false
});
app.post('/fetch-video-urls', async (req, res) => {
    const { pageUrl } = req.body;
    if (!pageUrl) return res.status(400).json({ error: 'Page URL is required' });
    try {
        const response = await axios.get(pageUrl, { httpsAgent: agent });
        const html = response.data;
        const $ = cheerio.load(html);
        let videoUrls = [];
        $('video source').each((i, element) => {
            let videoUrl = $(element).attr('src');
            if (videoUrl) {
                videoUrl = videoUrl.startsWith('http') ? videoUrl : `${new URL(pageUrl).origin}${videoUrl}`;
                videoUrls.push(videoUrl);
            }
        });
        if (videoUrls.length === 0) return res.status(404).json({ error: 'No video URLs found on the page' });
        return res.json({ videoUrls });
    } catch (error) {
        console.error('Error fetching video URLs:', error);
        return res.status(500).json({ error: 'Error fetching video URLs' });
    }
});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
