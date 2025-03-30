

const { app, BrowserWindow, globalShortcut } = require('electron');
const screenshot = require('screenshot-desktop');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");

let smallOverlayWindow;
let config;
let lastCapturedImageBase64 = null; // Store the last captured screenshot as Base64

// Load configuration
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = fs.readFileSync(configPath);
  config = JSON.parse(configData);

  if (!config.apiKey) {
    throw new Error("API key is missing in the config file");
  }
  if (!config.model) {
    config.model = "gemini-pro-vision";
    console.log("Model not specified in config, using default:", config.model);
  }
} catch (err) {
  console.error("Error reading config file:", err);
  app.quit();
}

const gemini = new GoogleGenerativeAI(config.apiKey);

// Function to capture the screen
async function captureActiveScreen() {
  try {
    if (smallOverlayWindow) {
      smallOverlayWindow.hide();
    }
    await new Promise(res => setTimeout(res, 200)); // Wait for the window to hide

    const timestamp = Date.now();
    const imagePath = path.join(app.getPath('pictures'), `screenshot_${timestamp}.png`);

    await screenshot({ filename: imagePath });

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    if (smallOverlayWindow) {
      smallOverlayWindow.show();
    }

    return base64Image; // Return the screenshot as a Base64 string
  } catch (err) {
    if (smallOverlayWindow) {
      smallOverlayWindow.show();
    }
    console.error("Error capturing active screen:", err);
    throw err;
  }
}

// Function to call Google Gemini API
async function callGoogleGemini(base64Image) {
  try {
    const model = gemini.getGenerativeModel({ model: config.model });
    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            { text: "code in C++" },
            { inlineData: { mimeType: "image/png", data: base64Image } },
          ],
        },
      ],
    });

    return result.response.text();
  } catch (err) {
    console.error("Error calling Google Gemini:", err);
    throw err;
  }
}

// Function to format API response
function formatApiResponse(response) {
  try {
    // Parse the response to extract the code block
    const codeBlockMatch = response.match(/```([a-zA-Z]*)\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      const language = codeBlockMatch[1] || 'plaintext'; // Extract language or default to plaintext
      const code = codeBlockMatch[2]; // Extract the code block

      // Return formatted HTML with Prism.js syntax highlighting
      return `
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
        <pre><code class="language-${language}">${code}</code></pre>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-${language}.min.js"></script>
        <script>Prism.highlightAll();</script>
      `;
    }

    // If no code block is found, return the plain response
    return `<div>${response}</div>`;
  } catch (err) {
    console.error("Error formatting API response:", err);
    return `<div>Error formatting response.</div>`;
  }
}

// Create the overlay window
app.whenReady().then(() => {
  smallOverlayWindow = new BrowserWindow({
    width: 800,
    height: 800,
    x: undefined,
    y: undefined,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    transparent: true,
    frame: false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: true,
    contentProtection: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  smallOverlayWindow.setContentProtection(true);
  smallOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  smallOverlayWindow.loadFile('index.html');

  globalShortcut.register('Command+\'', async () => {
    console.log("Cmd + ' pressed. Capturing active screen...");
    try {
      lastCapturedImageBase64 = await captureActiveScreen();
      console.log("Screenshot captured. Press Cmd + Enter to send it to Google Gemini.");
      smallOverlayWindow.webContents.send('update-response', 'Screenshot captured. Press Cmd + Enter to send it to Google Gemini.');
    } catch (err) {
      console.error("Error during screenshot capture:", err);
      smallOverlayWindow.webContents.send('update-response', 'Error capturing screenshot.');
    }
  });

  // Register the global shortcut for Cmd + Enter
  globalShortcut.register('Command+Enter', async () => {
    console.log("Cmd + Enter pressed. Sending screenshot to Google Gemini...");
    if (!lastCapturedImageBase64) {
      console.log("No screenshot available. Please capture a screenshot first.");
      smallOverlayWindow.webContents.send('update-response', 'No screenshot available. Press Cmd + \' to capture one.');
      return;
    }

    try {
      const response = await callGoogleGemini(lastCapturedImageBase64);
      console.log("Response from Google Gemini:", response);

      // Send the response content to the overlay window
      smallOverlayWindow.webContents.send('analysis-result', response);
    } catch (err) {
      console.error("Error during API call:", err);
      smallOverlayWindow.webContents.send('update-response', 'Error during API call.');
    }
  });
  globalShortcut.register('Command+[', () => {
    console.log("Cmd + [ pressed. Scrolling up...");
    smallOverlayWindow.webContents.send('scroll-up');
  });

  globalShortcut.register('Command+]', () => {
    console.log("Cmd + ] pressed. Scrolling down...");
    smallOverlayWindow.webContents.send('scroll-down');
  });

  globalShortcut.register('Command+.', () => {
    console.log("Cmd + > pressed. Moving window to the right...");
    const bounds = smallOverlayWindow.getBounds();
    smallOverlayWindow.setBounds({
      x: bounds.x + 50,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  });

  globalShortcut.register('Command+,', () => {
    console.log("Cmd + < pressed. Moving window to the left...");
    const bounds = smallOverlayWindow.getBounds();
    smallOverlayWindow.setBounds({
      x: bounds.x - 50,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
