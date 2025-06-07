import express from "express";
import bodyParser from "body-parser";
import morgan from "morgan";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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

// For local development
if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

// Export the Express app for Vercel
export default app;