import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import morgan from "morgan";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

// AWS S3 Configuration
const s3Client = new S3Client({
  region: "us-east-2", // Hardcoded to bypass env var issue
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Log the actual S3 client configuration
console.log("=== S3 Client Configuration ===");
console.log("S3 Client region:", s3Client.config.region);
console.log("S3 Client config:", JSON.stringify(s3Client.config, null, 2));

app.use(bodyParser.json());
app.use(morgan("tiny"));

// Serve static files from the public directory
app.use(express.static(join(__dirname, "public")));

// Set up EJS
app.set("view engine", "ejs");
app.set("views", join(__dirname, "public"));

app.get("/", (req, res) => {
    res.render("home", { root: join(__dirname, "public") });
});

// Debug endpoint to check environment variables (remove in production)
app.get("/debug", (req, res) => {
    console.log("=== Environment Variables Debug ===");
    console.log("All environment variables:", Object.keys(process.env).filter(key => key.includes('AWS')));
    console.log("AWS_REGION from env:", process.env.AWS_REGION);
    console.log("AWS_REGION type:", typeof process.env.AWS_REGION);
    console.log("AWS_REGION length:", process.env.AWS_REGION?.length);
    console.log("S3 Client actual region:", s3Client.config.region);
    
    res.json({
        aws_region_env: process.env.AWS_REGION || 'not set',
        aws_region_actual: s3Client.config.region,
        aws_region_type: typeof process.env.AWS_REGION,
        aws_region_length: process.env.AWS_REGION?.length,
        s3_bucket: process.env.S3_BUCKET_NAME || 'not set',
        has_access_key: !!process.env.AWS_ACCESS_KEY_ID,
        has_secret_key: !!process.env.AWS_SECRET_ACCESS_KEY,
        node_env: process.env.NODE_ENV || 'not set',
        all_aws_vars: Object.keys(process.env).filter(key => key.includes('AWS'))
    });
});

// Endpoint to list music files from S3
app.get("/api/music", async (req, res) => {
    try {
        console.log("=== S3 Configuration Debug ===");
        console.log("AWS_REGION:", process.env.AWS_REGION);
        console.log("S3_BUCKET_NAME:", process.env.S3_BUCKET_NAME);
        console.log("AWS_ACCESS_KEY_ID exists:", !!process.env.AWS_ACCESS_KEY_ID);
        console.log("AWS_SECRET_ACCESS_KEY exists:", !!process.env.AWS_SECRET_ACCESS_KEY);
        
        if (!BUCKET_NAME) {
            console.error("S3_BUCKET_NAME environment variable not set");
            return res.status(500).json({ error: 'S3_BUCKET_NAME environment variable not set' });
        }

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            console.error("AWS credentials not set");
            return res.status(500).json({ error: 'AWS credentials not configured' });
        }

        console.log("Attempting to list objects from bucket:", BUCKET_NAME);
        
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            Prefix: "", // Files are in the root of the bucket
        });

        const response = await s3Client.send(command);
        const musicFiles = response.Contents
            ?.filter(obj => obj.Key && obj.Key.endsWith('.m4a'))
            .map(obj => obj.Key) // Keep the full key since files are in root
            .filter(filename => filename) || [];

        console.log(`Found ${musicFiles.length} music files in S3`);
        res.json(musicFiles);
    } catch (error) {
        console.error('Error listing music files from S3:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        
        // Send more specific error messages
        if (error.name === 'AccessDenied') {
            res.status(500).json({ error: 'Access denied to S3 bucket - check IAM permissions' });
        } else if (error.name === 'NoSuchBucket') {
            res.status(500).json({ error: 'S3 bucket does not exist' });
        } else if (error.name === 'InvalidAccessKeyId') {
            res.status(500).json({ error: 'Invalid AWS Access Key ID' });
        } else if (error.name === 'SignatureDoesNotMatch') {
            res.status(500).json({ error: 'Invalid AWS Secret Access Key' });
        } else {
            res.status(500).json({ error: `S3 error: ${error.message}` });
        }
    }
});

// Endpoint to get a signed URL for a music file from S3
app.get("/api/music/:filename", async (req, res) => {
    try {
        const filename = req.params.filename;
        const key = filename; // Files are in the root, no prefix needed
        
        console.log('Generating signed URL for S3 file:', key);
        
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        const signedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600, // 1 hour
        });
            
        console.log('Generated signed URL successfully');
        res.json({ url: signedUrl });
    } catch (error) {
        console.error('Error generating signed URL for', req.params.filename, ':', error);
        res.status(500).json({ error: 'Failed to generate signed URL' });
    }
});

// Proxy endpoint to stream audio directly from S3 (avoids CORS issues)
app.get("/music/:filename", async (req, res) => {
    try {
        const filename = req.params.filename;
        const key = filename; // Files are in the root, no prefix needed
        
        console.log('Streaming audio from S3:', key);
        
        const command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        const response = await s3Client.send(command);
        
        // Set proper headers for audio streaming
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', response.ContentLength);
        
        // Stream the audio data
        if (response.Body) {
            response.Body.pipe(res);
        } else {
            res.status(404).json({ error: 'Audio file not found' });
        }
        
    } catch (error) {
        console.error('Error streaming audio from S3:', error);
        res.status(404).json({ error: 'Audio file not found' });
    }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    console.log(`S3 Bucket: ${BUCKET_NAME || 'Not configured'}`);
});

// Export the Express app for Vercel
export default app;