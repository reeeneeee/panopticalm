import express from "express";
import bodyParser from "body-parser";
import morgan from "morgan";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

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

// Endpoint to list music files
app.get("/api/music", async (req, res) => {
    try {
        const musicDir = join(__dirname, "public", "music");
        const files = await fs.readdir(musicDir);
        const musicFiles = files.filter(file => file.endsWith('.m4a'));
        res.json(musicFiles);
    } catch (error) {
        console.error('Error reading music directory:', error);
        res.status(500).json({ error: 'Failed to read music directory' });
    }
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Export the Express app for Vercel
export default app;