# QUICKSTART_RUN.md

## Steps to Run the Application

1. **Set Up Node Version** in Your Terminal:
   ```bash
   nvm use 20
   ```

2. **Install Dependencies for Core Module**:
   ```bash
   npm install
   ```

3. **Build the Core Module**:
   ```bash
   cd ./modules/core
   npm run build:watch
   ```

4. **Open a New Terminal** and Start the Web Development Server:
   ```bash
   cd ./modules/browser
   nvm use 20
   npm install
   npm install use-sync-external-store use-isomorphic-layout-effect
   npm start
   ```

5. **Open Another New Terminal** and Start the API Server:
   ```bash
   cd ./modules/server
   nvm use 20
   node -r ts-node/register/transpile-only ./src/dev.ts
   ```

6. **Access the App**:
   - Open your browser and navigate to `http://localhost/` to access the application.