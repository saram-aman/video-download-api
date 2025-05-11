const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const https = require('https');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 4000;

// Configure CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Create HTTPS agent to handle self-signed certificates
const agent = new https.Agent({
    rejectUnauthorized: false
});

// Helper function to extract video URLs from HTML
const extractVideosFromHTML = (html) => {
    const $ = cheerio.load(html);
    const videoSources = [];
    
    // Extract video tags
    $('video').each((_, element) => {
        const src = $(element).attr('src');
        if (src) videoSources.push(src);
        
        // Check for source tags within video
        $(element).find('source').each((_, sourceElement) => {
            const sourceSrc = $(sourceElement).attr('src');
            if (sourceSrc) videoSources.push(sourceSrc);
        });
    });
    
    return videoSources;
};

// Check if a URL is a valid video URL
const isVideoUrl = (url) => {
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov', '.flv', '.avi', '.wmv', '.m3u8', '.mpd', '.ts'];
    const videoPatterns = ['video', 'stream', 'playlist', 'manifest', 'content'];
    
    // Check extensions
    if (videoExtensions.some(ext => url.toLowerCase().includes(ext))) {
        return true;
    }
    
    // Check common video URL patterns
    if (videoPatterns.some(pattern => url.toLowerCase().includes(pattern))) {
        return true;
    }
    
    return false;
};

// Alternative endpoint that doesn't use Puppeteer
app.post('/fetch-video-urls-simple', async (req, res) => {
    const { pageUrl } = req.body;
    
    if (!pageUrl) {
        return res.status(400).json({ error: 'Page URL is required' });
    }
    
    try {
        const videoUrls = new Set();
        
        // Direct HTTP request to get HTML content
        const response = await axios.get(pageUrl, { 
            httpsAgent: agent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            }
        });
        
        // Extract videos using Cheerio
        const htmlVideos = extractVideosFromHTML(response.data);
        htmlVideos.forEach(url => videoUrls.add(url));
        
        // Look for video URLs in the page source
        const $ = cheerio.load(response.data);
        const html = $.html();
        
        // Find URLs with video extensions
        const urlRegex = /(https?:\/\/[^"'\s)]+\.(mp4|webm|ogg|m3u8|mpd|mov|flv|avi|wmv|ts))/g;
        const matches = html.match(urlRegex);
        if (matches) {
            matches.forEach(match => videoUrls.add(match));
        }
        
        // Find URLs in script tags that might be video sources
        $('script').each((_, element) => {
            const scriptContent = $(element).html();
            if (scriptContent) {
                // Look for video player configurations
                if (scriptContent.includes('video') || 
                    scriptContent.includes('player') || 
                    scriptContent.includes('stream')) {
                    
                    const urlMatches = scriptContent.match(/"(https?:\/\/[^"]+)"/g);
                    if (urlMatches) {
                        urlMatches
                            .map(url => url.replace(/"/g, ''))
                            .filter(url => isVideoUrl(url))
                            .forEach(url => videoUrls.add(url));
                    }
                }
            }
        });
        
        // Convert Set to Array and make sure URLs are absolute
        const finalVideoUrls = Array.from(videoUrls)
            .filter(url => url && url.trim() !== '')
            .map(url => {
                // Make relative URLs absolute
                if (url.startsWith('/')) {
                    try {
                        const baseUrl = new URL(pageUrl);
                        return `${baseUrl.origin}${url}`;
                    } catch (e) {
                        return url;
                    }
                }
                return url;
            });
        
        if (finalVideoUrls.length === 0) {
            return res.status(404).json({ 
                error: 'No video URLs found on the page', 
                message: 'Try using the standard endpoint or check if the site uses a custom video player'
            });
        }
        
        return res.json({ 
            videoUrls: finalVideoUrls,
            pageUrl: pageUrl,
            count: finalVideoUrls.length,
            method: 'simple'
        });
        
    } catch (error) {
        console.error('Error fetching video URLs (simple):', error);
        console.error('Error fetching video URLs with Puppeteer:', error);
        
        // Fall back to simple method if Puppeteer fails
        try {
            const response = await axios.get(pageUrl, { 
                httpsAgent: agent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                }
            });
            
            const videoUrls = new Set();
            
            // Extract videos using Cheerio
            const htmlVideos = extractVideosFromHTML(response.data);
            htmlVideos.forEach(url => videoUrls.add(url));
            
            // Look for video URLs in the page source
            const $ = cheerio.load(response.data);
            const html = $.html();
            
            const urlRegex = /(https?:\/\/[^"'\s)]+\.(mp4|webm|ogg|m3u8|mpd|mov|flv|avi|wmv|ts))/g;
            const matches = html.match(urlRegex);
            if (matches) {
                matches.forEach(match => videoUrls.add(match));
            }
            
            // Convert Set to Array and make sure URLs are absolute
            const finalVideoUrls = Array.from(videoUrls)
                .filter(url => url && url.trim() !== '')
                .map(url => {
                    // Make relative URLs absolute
                    if (url.startsWith('/')) {
                        try {
                            const baseUrl = new URL(pageUrl);
                            return `${baseUrl.origin}${url}`;
                        } catch (e) {
                            return url;
                        }
                    }
                    return url;
                });
            
            if (finalVideoUrls.length === 0) {
                return res.status(404).json({ 
                    error: 'No video URLs found on the page', 
                    message: 'The page may use a custom video player or require JavaScript'
                });
            }
            
            return res.json({ 
                videoUrls: finalVideoUrls,
                pageUrl: pageUrl,
                count: finalVideoUrls.length,
                method: 'fallback'
            });
            
        } catch (fallbackError) {
            return res.status(500).json({ 
                error: 'Error fetching video URLs', 
                message: `Original error: ${error.message}. Fallback error: ${fallbackError.message}`
            });
        }
    }
});

// Main endpoint for fetching video URLs
app.post('/fetch-video-urls', async (req, res) => {
    const { pageUrl } = req.body;
    
    if (!pageUrl) {
        return res.status(400).json({ error: 'Page URL is required' });
    }
    
    try {
        // Set with found URLs to avoid duplicates
        const videoUrls = new Set();
        
        // METHOD 1: Use Puppeteer for dynamic content
        const browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        });
        
        const page = await browser.newPage();
        
        // Monitor network requests for video content
        await page.setRequestInterception(true);
        
        page.on('request', (request) => {
            const url = request.url();
            if (isVideoUrl(url)) {
                videoUrls.add(url);
            }
            request.continue();
        });
        
        // Monitor responses for video content type
        page.on('response', async (response) => {
            const contentType = response.headers()['content-type'] || '';
            const url = response.url();
            
            if (contentType.includes('video/') || isVideoUrl(url)) {
                videoUrls.add(url);
            }
        });
        
        // Navigate to the page and wait for network to settle
        await page.goto(pageUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 // Increase timeout for slow sites
        });
        
        // Run JavaScript to find any embedded video players
        const pageVideos = await page.evaluate(() => {
            const sources = [];
            
            // Extract from video elements
            document.querySelectorAll('video').forEach(video => {
                if (video.src) sources.push(video.src);
                video.querySelectorAll('source').forEach(source => {
                    if (source.src) sources.push(source.src);
                });
            });
            
            // Look for video in iframes
            document.querySelectorAll('iframe').forEach(iframe => {
                if (iframe.src) sources.push(iframe.src);
            });
            
            // Look for JavaScript variables that might contain video URLs
            const pageText = document.documentElement.innerHTML;
            const urlRegex = /https?:\/\/[^"'\s)]+\.(mp4|webm|ogg|m3u8|mpd)/g;
            const matches = pageText.match(urlRegex);
            if (matches) {
                matches.forEach(match => sources.push(match));
            }
            
            return sources;
        });
        
        pageVideos.forEach(url => videoUrls.add(url));
        
        // Get HTML content for further processing
        const html = await page.content();
        await browser.close();
        
        // METHOD 2: Use Cheerio to parse HTML
        const htmlVideos = extractVideosFromHTML(html);
        htmlVideos.forEach(url => videoUrls.add(url));
        
        // METHOD 3: Try a direct HTTP request for sites that block headless browsers
        try {
            const response = await axios.get(pageUrl, { httpsAgent: agent });
            const directHtmlVideos = extractVideosFromHTML(response.data);
            directHtmlVideos.forEach(url => videoUrls.add(url));
        } catch (error) {
            // Silently fail - we already tried with Puppeteer
            console.log('Direct HTTP request failed, continuing with Puppeteer results');
        }
        
        // Convert Set to Array and make sure URLs are absolute
        const finalVideoUrls = Array.from(videoUrls)
            .filter(url => url && url.trim() !== '')
            .map(url => {
                // Make relative URLs absolute
                if (url.startsWith('/')) {
                    try {
                        const baseUrl = new URL(pageUrl);
                        return `${baseUrl.origin}${url}`;
                    } catch (e) {
                        return url;
                    }
                }
                return url;
            });
        
        if (finalVideoUrls.length === 0) {
            return res.status(404).json({ 
                error: 'No video URLs found on the page', 
                message: 'Try a different URL or check if the site uses a custom video player'
            });
        }
        
        return res.json({ 
            videoUrls: finalVideoUrls,
            pageUrl: pageUrl,
            count: finalVideoUrls.length
        });
        
    } catch (error) {
        console.error('Error fetching video URLs:', error);
        return res.status(500).json({ 
            error: 'Error fetching video URLs', 
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Video Download API is running' });
});

// Default route
app.get('/', (req, res) => {
    res.json({
        message: 'Video Download API',
        endpoints: {
            standard: 'POST to /fetch-video-urls with { "pageUrl": "https://example.com" }',
            simple: 'POST to /fetch-video-urls-simple with { "pageUrl": "https://example.com" }'
        },
        note: 'If the standard endpoint fails, try the simple endpoint which doesn\'t use Puppeteer',
        author: 'Saram Aman (Enhanced)'
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
