const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const https = require('https');
const cors = require('cors'); 
const app = express(); 
const PORT = 4000; 
app.use(cors()); 
app.use(express.json());
const agent = new https.Agent({
    rejectUnauthorized: false
});
pp.post('/fetch-video-urls', async (req, res) => {
    const { pageUrl } = req.body;
    if (!pageUrl) return res.status(400).json({ error: 'Page URL is required' });
    try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        let videoUrls = [];
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('video')) {
                videoUrls.push(url);
            }
            request.continue();
        });
        await page.goto(pageUrl, { waitUntil: 'networkidle2' });
        await browser.close();
        videoUrls = [...new Set(videoUrls)];
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
