require("dotenv").config();
const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const express = require("express");
  const cors = require("cors");
const { google } = require("googleapis");
const axios = require("axios");
const multer = require("multer");
const streamifier = require("streamifier");
const archiver = require("archiver");

const app = express();

app.use(cors());
app.use(express.json());


// Google OAuth setup

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
  refresh_token: process.env.REFRESH_TOKEN,
});

const drive = google.drive({
  version: "v3",
  auth: oauth2Client,
});


// Multer setup

const upload = multer();


// Check if folder exists

async function findFolder(name, parentId = null) {

  const query = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: "files(id, name)",
  });

  if (response.data.files.length > 0) {
    return response.data.files[0];
  } else {
    return null;
  }
}


app.get("/", (req, res) => {
  res.send("Backend running...");
});


// Create folder structure: Shivang / eventName / folderName

app.post("/create-folder-structure", async (req, res) => {

  try {

    const { eventName, folderName } = req.body;
    const userName = "Shivang";


    let userFolder = await findFolder(userName);

    if (!userFolder) {
      const created = await drive.files.create({
        requestBody: {
          name: userName,
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id, name",
      });

      userFolder = created.data;
    }

    // Event folder

    let eventFolder = await findFolder(eventName, userFolder.id);

    if (!eventFolder) {
      const created = await drive.files.create({
        requestBody: {
          name: eventName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [userFolder.id],
        },
        fields: "id, name",
      });

      eventFolder = created.data;
    }

    let selectedFolder = await findFolder(folderName, eventFolder.id);

    if (!selectedFolder) {
      const created = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [eventFolder.id],
        },
        fields: "id, name",
      });

      selectedFolder = created.data;
    }

    res.json({
      message: "Structure ready",
      uploadFolderId: selectedFolder.id,
    });

  } catch (error) {

    console.error(error);
    res.status(500).send("Structure creation failed");
  }

});


// Upload file

app.post("/upload-file", upload.single("file"), async (req, res) => {

  try {

    const { parentId } = req.body;

    if (!parentId) {
      return res.status(400).json({ error: "Missing parentId" });
    }

    const fileMetadata = {
      name: req.file.originalname,
      parents: [parentId],
    };

    const media = {
      mimeType: req.file.mimetype,
      body: streamifier.createReadStream(req.file.buffer),
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });

    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    res.json({
      message: "Upload successful",
      fileId: file.data.id,
    });

  } catch (error) {

    console.error("UPLOAD ERROR:", error.message);
    res.status(500).json({ error: "Upload failed" });
  }
});


app.get("/list-files", async (req, res) => {

  try {

    const response = await drive.files.list({
      pageSize: 20,
      fields: "files(id, name, parents)",
    });

    res.json(response.data.files);

  } catch (error) {

    console.error(error);
    res.status(500).send("Error listing files");
  }

});



app.get("/whoami", async (req, res) => {

  const about = await drive.about.get({
    fields: "user",
  });

  res.json(about.data);

});


// Get event folder id

app.get("/get-event-folder", async (req, res) => {
  try {
    const { eventName } = req.query;
    const userName = "Shivang";

    let userFolder = await findFolder(userName);
    if (!userFolder) {
      return res.status(404).json({ error: "User folder not found" });
    }

    let eventFolder = await findFolder(eventName, userFolder.id);
    if (!eventFolder) {
      return res.status(404).json({ error: "Event folder not found" });
    }

    res.json({ eventFolderId: eventFolder.id });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get event folder" });
  }
});


//  Get all subfolders inside event folder
app.get("/get-event-folders", async (req, res) => {
  try {
    const { eventName } = req.query;
    const userName = "Shivang";


    const userFolder = await findFolder(userName);
    if (!userFolder) {
      return res.status(404).json({ error: "User folder not found" });
    }

  
    const eventFolder = await findFolder(eventName, userFolder.id);
    if (!eventFolder) {
      return res.status(404).json({ error: "Event folder not found" });
    }

    // 3️Get all folders inside event
    const response = await drive.files.list({
      q: `'${eventFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id,name)",
    });

    res.json({
      folders: response.data.files,
    });

  } catch (error) {
    console.error("GET EVENT FOLDERS ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch folders" });
  }
});


// Get all images inside subfolders
app.get("/get-files", async (req, res) => {
  try {
    const { parentId } = req.query;

    if (!parentId) {
      return res.status(400).json({ error: "Missing parentId" });
    }

    let allImages = [];

  
    const folderResponse = await drive.files.list({
      q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
    });

    const subfolders = folderResponse.data.files; 

    console.log("Subfolders found:", subfolders);

    
    for (const folder of subfolders) {
      const fileResponse = await drive.files.list({
        q: `'${folder.id}' in parents and trashed=false`,
        fields: "files(id, name, mimeType, size)",
      });

      const files = fileResponse.data.files.map(file => ({
        id: file.id,
        name: file.name,
        size: file.size,
        url: `${BASE_URL}/image/${file.id}`,
      }));

      allImages = [...allImages, ...files];
    }

    console.log("Files found:", allImages);

    res.json({ files: allImages });

  } catch (error) {
    console.error("GET FILES ERROR:", error.message);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});


// Stream image directly from Google Drive
app.get("/image/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const file = await drive.files.get(
      { fileId: id, alt: "media" },
      { responseType: "stream" }
    );

    file.data.pipe(res);

  } catch (error) {
    console.error("IMAGE STREAM ERROR:", error.message);
    res.status(500).send("Failed to fetch image");
  }
});



app.get("/debug-children", async (req, res) => {
  try {
    const { parentId } = req.query;

    const response = await drive.files.list({
      q: `'${parentId}' in parents`,
      fields: "files(id, name, mimeType)",
    });

    console.log("Children:", response.data.files);
    res.json(response.data.files);

  } catch (error) {
    console.error("DEBUG ERROR:", error.response?.data || error.message);
    res.status(500).json({ error: error.response?.data || error.message });
  }
});


// CREATE CAMERA FOLDER INSIDE EVENT
app.post("/create-camera-folder", async (req, res) => {
  try {

    const { eventName } = req.body;
    const userName = "Shivang";

    let userFolder = await findFolder(userName);

    if (!userFolder) {
      return res.status(404).json({ error: "User folder not found" });
    }

    let eventFolder = await findFolder(eventName, userFolder.id);

    if (!eventFolder) {
      const created = await drive.files.create({
        requestBody: {
          name: eventName,
          mimeType: "application/vnd.google-apps.folder",
          parents: [userFolder.id],
        },
        fields: "id, name",
      });

      eventFolder = created.data;
    }

  
    let cameraFolder = await findFolder("Camera Upload", eventFolder.id);

    if (!cameraFolder) {
      const created = await drive.files.create({
        requestBody: {
          name: "Camera Upload",
          mimeType: "application/vnd.google-apps.folder",
          parents: [eventFolder.id],
        },
        fields: "id, name",
      });

      cameraFolder = created.data;
    }

    res.json({
      cameraFolderId: cameraFolder.id,
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Camera folder creation failed");
  }
});

  //  CAMERA UPLOAD

app.post("/get-upload-url", async (req, res) => {
  try {
    const { fileName, parentId } = req.body;

    if (!fileName || !parentId) {
      return res.status(400).json({
        error: "Missing fileName or parentId",
      });
    }

    const accessToken = await oauth2Client.getAccessToken();

    const response = await axios.post(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        name: fileName,
        parents: [parentId],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const uploadUrl = response.headers.location;

    if (!uploadUrl) {
      throw new Error("Upload URL not received");
    }

    console.log("Generated upload URL:", fileName);

    res.json({ uploadUrl });

  } catch (err) {
    console.error(
      "UPLOAD URL ERROR:",
      err.response?.data || err.message
    );

    res.status(500).json({
      error: "Failed to generate upload URL",
    });
  }
});



// Download full event as ZIP (streaming - production safe)
app.get("/download-zip/:eventName", async (req, res) => {
  try {
    const { eventName } = req.params;
    const userName = "Shivang";

    const MAX_SIZE = 500 * 1024 * 1024; 

 
    const userFolder = await findFolder(userName);
    if (!userFolder) {
      return res.status(404).send("User folder not found");
    }

 
    const eventFolder = await findFolder(eventName, userFolder.id);
    if (!eventFolder) {
      return res.status(404).send("Event folder not found");
    }

    const eventFolderId = eventFolder.id;

   
    const folderResponse = await drive.files.list({
      q: `'${eventFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
    });

    const subfolders = folderResponse.data.files;

    let totalSize = 0;
    let allFiles = [];


    for (const folder of subfolders) {
      const fileResponse = await drive.files.list({
        q: `'${folder.id}' in parents and trashed=false`,
        fields: "files(id, name, mimeType, size)",
      });

      const files = fileResponse.data.files;

      for (const file of files) {
        if (!file.size) continue;

        totalSize += Number(file.size);

        allFiles.push({
          id: file.id,
          name: file.name,
          folderName: folder.name,
          mimeType: file.mimeType,
        });
      }
    }

    console.log("Total size:", totalSize / (1024 * 1024), "MB");

   
    if (totalSize > MAX_SIZE) {
      return res.status(400).send("Download exceeds 500MB limit");
    }

  
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${eventName}.zip`
    );

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    archive.on("error", (err) => {
  console.error("Archive error:", err);
  res.status(500).send("Archive failed");
});


    archive.pipe(res);

    for (const file of allFiles) {
      const driveStream = await drive.files.get(
        { fileId: file.id, alt: "media" },
        { responseType: "stream" }
      );

      archive.append(driveStream.data, {
        name: `${file.folderName}/${file.name}`,
      });
    }

    
    await archive.finalize();
  } catch (error) {
    console.error("ZIP DOWNLOAD ERROR:", error);
    res.status(500).send("Download failed");
  }
});


app.post("/download-selected", async (req, res) => {
  try {
    const { files } = req.body; 
    const MAX_SIZE = 500 * 1024 * 1024;

    if (!files || files.length === 0) {
      return res.status(400).send("No files selected");
    }

    let totalSize = 0;

    
    for (const file of files) {
      const meta = await drive.files.get({
        fileId: file.id,
        fields: "size",
      });

      totalSize += Number(meta.data.size || 0);
    }

    console.log("Selected total size:", totalSize / (1024 * 1024), "MB");

    if (totalSize > MAX_SIZE) {
      return res.status(400).send("Selected files exceed 500MB limit");
    }

    
    res.setHeader("Content-Type", "application/zip");

res.setHeader("Content-Disposition", `attachment; filename=Selected.zip`);

const archive = archiver("zip", {
  zlib: { level: 9 },
});

archive.on("error", (err) => {
  console.error("Archive error:", err);
  if (!res.headersSent) {
    res.status(500).send("Archive failed");
  }
});

archive.pipe(res);

for (const file of files) {
  const driveStream = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "stream" }
  );

  archive.append(driveStream.data, {
    name: file.name,
  });
}

await archive.finalize();
  } catch (error) {
    console.error("SELECTED ZIP ERROR:", error);
    res.status(500).send("Download failed");
  }
});


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
