require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const app = express();
const port = process.env.PORT || 3000;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = process.env.YOUTUBE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const youtube = google.youtube({
    version: 'v3',
    auth: API_KEY
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

app.post('/api/convert', async (req, res) => {
    try {
        const { videoId } = req.body;
        console.log('Processing video ID:', videoId);
        console.log('Using YouTube API Key:', API_KEY ? 'Key is present' : 'Key is missing');

        // Get video details and transcript using the transcript endpoint
        const videoResponse = await youtube.videos.list({
            part: 'snippet',
            id: videoId
        }).catch(error => {
            console.error('YouTube API Error:', error.message);
            throw error;
        });

        if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
            throw new Error('Video not found');
        }

        // Use the YouTube transcript API instead
        const transcript = await getTranscript(videoId);

        res.json({ 
            success: true,
            text: transcript,
            videoTitle: videoResponse.data.items[0].snippet.title
        });

    } catch (error) {
        console.error('Error details:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.response ? error.response.data : null
        });
    }
});

async function getTranscript(videoId) {
    // We'll use the YouTube Transcript API
    const { YoutubeTranscript } = require('youtube-transcript');
    
    try {
        const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
        return transcriptItems.map(item => item.text).join(' ');
    } catch (error) {
        throw new Error('Could not fetch transcript. Make sure the video has captions available.');
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