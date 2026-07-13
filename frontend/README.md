# Meetify Frontend

Modern, beautiful web application for local activities and community management.

## 🚀 Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the Vite development server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000` and over the local network.

---

## 🔒 Secure Testing on Mobile (HTTPS)

Modern browser APIs such as the **Microphone (Voice Messaging)**, **Camera**, **Geolocation**, and **Notifications** are strictly restricted to secure contexts (`localhost` or `HTTPS`).

To test these features on real mobile devices or external browsers during local development, you must expose the dev server through a secure tunnel using Cloudflare Tunnel.

### Step 1: Install Cloudflare Tunnel (`cloudflared`)

- **Windows** (using PowerShell):
  ```powershell
  winget install Cloudflare.cloudflared
  ```
  *(Or download the MSI installer from [Cloudflare's Downloads Page](https://github.com/cloudflare/cloudflared/releases))*

- **macOS**:
  ```bash
  brew install cloudflared
  ```

- **Linux**:
  ```bash
  # Debian/Ubuntu
  sudo apt-get install cloudflared
  ```

### Step 2: Start the Tunnel

1. Ensure your local dev server is running on port `3000` (`npm run dev`).
2. Run the tunnel command in a separate terminal:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Cloudflare will automatically generate a secure public URL ending with `.trycloudflare.com` (for example, `https://your-random-subdomain.trycloudflare.com`).
4. Scan the QR code or open that HTTPS link on your mobile browser. The microphone permissions and audio recording will now work perfectly.
