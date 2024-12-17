require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const app = express();
const port = process.env.PORT || 3000;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = process.env.YOUTUBE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Configure CORS
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://yttranscript-7d84.onrender.com'],
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json());
app.use(express.static('.'));

// Add request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    console.log('Request headers:', req.headers);
    console.log('Request body:', req.body);
    next();
});

const youtube = google.youtube({
    version: 'v3',
    auth: API_KEY
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

app.post('/api/convert', async (req, res) => {
    try {
        const { videoId } = req.body;
        if (!videoId) {
            return res.status(400).json({
                success: false,
                error: 'Video ID is required'
            });
        }

        console.log('Processing video ID:', videoId);
        console.log('Using YouTube API Key:', API_KEY ? 'Key is present' : 'Key is missing');

        if (!API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'YouTube API key is not configured'
            });
        }

        // Get video details and transcript using the transcript endpoint
        const videoResponse = await youtube.videos.list({
            part: 'snippet',
            id: videoId
        }).catch(error => {
            console.error('YouTube API Error:', error.message);
            throw error;
        });

        if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Video not found'
            });
        }

        // Use the YouTube transcript API instead
        const transcript = await getTranscript(videoId);

        return res.json({ 
            success: true,
            text: transcript,
            videoTitle: videoResponse.data.items[0].snippet.title
        });

    } catch (error) {
        console.error('Error details:', error);
        console.error('Stack trace:', error.stack);
        
        // Send a more specific status code based on the error
        let statusCode = 500;
        if (error.message.includes('not have automatic captions')) {
            statusCode = 400;
        } else if (error.message.includes('Video not found') || error.message.includes('unavailable')) {
            statusCode = 404;
        }

        return res.status(statusCode).json({ 
            success: false, 
            error: error.message,
            details: error.response ? error.response.data : null
        });
    }
});

async function getTranscript(videoId) {
    const { YoutubeTranscript } = require('youtube-transcript');
    const { getSubtitles } = require('youtube-caption-extractor');
    
    console.log('Attempting to fetch transcript for video:', videoId);
    
    // Try multiple methods to get the transcript
    const errors = [];
    
    // Method 1: YouTube Transcript API
    try {
        console.log('Trying YouTube Transcript API...');
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
        if (transcriptItems && transcriptItems.length > 0) {
            console.log('Successfully got transcript using YouTube Transcript API');
            return transcriptItems.map(item => item.text).join(' ');
        }
    } catch (error) {
        console.error('YouTube Transcript API Error:', error);
        errors.push(error.message);
    }

    // Method 2: YouTube Caption Extractor
    try {
        console.log('Trying YouTube Caption Extractor...');
        const subtitles = await getSubtitles({
            videoID: videoId,
            lang: 'en'  // Try English first
        });
        
        if (subtitles && subtitles.length > 0) {
            console.log('Successfully got transcript using Caption Extractor');
            return subtitles.map(item => item.text).join(' ');
        }
    } catch (error) {
        console.error('Caption Extractor Error:', error);
        errors.push(error.message);
    }

    // Method 3: Try YouTube Data API directly
    try {
        console.log('Trying YouTube Data API...');
        const captionsResponse = await youtube.captions.list({
            part: 'snippet',
            videoId: videoId
        });

        if (captionsResponse.data.items && captionsResponse.data.items.length > 0) {
            // If we find captions but couldn't get them with other methods,
            // it might be a permission issue
            throw new Error('Captions exist but could not be accessed. The video might have restricted captions.');
        }
    } catch (error) {
        console.error('YouTube API Error:', error);
        errors.push(error.message);
    }

    // If all methods failed, provide a detailed error
    console.error('All transcript fetching methods failed');
    console.error('Errors encountered:', errors);
    
    if (errors.some(e => e.includes('Could not find automatic captions') || 
                     e.includes('Transcript is disabled') ||
                     e.includes('subtitles are disabled'))) {
        throw new Error('This video does not have available captions. Please try a different video.');
    } else if (errors.some(e => e.includes('private') || e.includes('unavailable'))) {
        throw new Error('This video is private or unavailable.');
    } else {
        throw new Error('Failed to fetch transcript. Please make sure the video has captions enabled and try again.');
    }
}

app.post('/api/ask-ai', async (req, res) => {
    try {
        const { question, transcript, history } = req.body;
        
        // Initialize the model
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // Create the context from conversation history
        let conversationContext = '';
        if (history && history.length > 0) {
            conversationContext = 'Previous conversation:\n' + 
                history.map(msg => `${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`).join('\n') +
                '\n\nNow, ';
        }

        // Create the prompt with context
        const prompt = `Based on this video transcript: "${transcript.substring(0, 5000)}..."
                       ${conversationContext}please answer this question: ${question}
                       Please provide a clear and concise response based on the video content. Make it 3-4 sentences.`;

        // Generate response
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({
            success: true,
            answer: text
        });
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/summarize', async (req, res) => {
    try {
        const { text } = req.body;
        
        // Initialize the model
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // Create the prompt
        const prompt = `Please provide a concise summary of the following text: ${text.substring(0, 5000)}...`;

        // Generate summary
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const summary = response.text();

        res.json({
            success: true,
            summary: summary
        });
    } catch (error) {
        console.error('Summarization Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/expand-summary', async (req, res) => {
    try {
        const { text, currentSummary } = req.body;
        
        // Initialize the model
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // Create the prompt
        const prompt = `Based on this video transcript: "${text.substring(0, 5000)}..."
                       
                       Current summary: "${currentSummary}"
                       
                       Please add 2 sentences that provide additional details, specific examples, or key concepts that weren't mentioned in the current summary. 
                       Focus on interesting or important information that adds value to the summary.
                       Do not repeat information that's already in the summary.
                       Return the complete text (current summary + new detailed sentences).
                       Make the transition between the current summary and new information smooth.`;

        // Generate response
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const expandedSummary = response.text();

        res.json({
            success: true,
            summary: expandedSummary
        });
    } catch (error) {
        console.error('AI Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Using API key:', API_KEY ? 'API key is set' : 'API key is missing');
}); 