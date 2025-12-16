require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 3001;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      process.env.CLIENT_DOMAIN || "http://localhost:5173",
      "http://localhost:5174",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    console.error(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("utility_bill");
    const usersCollection = db.collection("users-am");
    const assetsCollection = db.collection("assets-am");
    const requestsCollection = db.collection("requests-am");
    const assignedAssetsCollection = db.collection("assignedAssets-db");
    const employeeAffiliationsCollection = db.collection(
      "employeeAffiliations-am"
    );
    const packagesCollection = db.collection("packages-am");
    const paymentsCollection = db.collection("payments-am");

    // role based middleware
    const verifyEmployee = async (req, res, next) => {
      try {
        const email = req.tokenEmail;
        const user = await usersCollection.findOne({ email });
        if (!user || user.role === "employee") {
          return res.status(403).send({ message: "Only employee actions" });
        }
        next();
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    };

    const verifyHR = async (req, res, next) => {
      try {
        const email = req.tokenEmail;
        const user = await usersCollection.findOne({ email });
        if (!user || user.role === "hr") {
          return res.status(403).send({ message: "Only HR actions" });
        }
        next();
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    };

    // users  APIs
    // post users
    app.post("/users", async (req, res) => {
      try {
        const userInfo = req.body;

        const existingUser = await usersCollection.findOne({
          email: userInfo?.email,
        });

        if (existingUser) {
          return res.status(409).send({ message: "User already exits" });
        }

        const result = await usersCollection.insertOne(userInfo);

        res.status(201).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // get a user
    app.get("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const result = await usersCollection.findOne({ email });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // get users role
    app.get("/user/role", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;
        const result = await usersCollection.findOne({ email });
        res.send({ role: result?.role });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // update user
    app.patch("/user", verifyJWT, async (req, res) => {
      try {
        const { name } = req.body;
        const email = req.tokenEmail;

        const result = await usersCollection.updateOne(
          { email },
          { $set: { name } }
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Asset APIs

    // Post asset
    app.post("/assets", async (req, res) => {
      try {
        const assetData = req.body;
        const result = await assetsCollection.insertOne(assetData);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Get all assets
    app.get("/assets", async (req, res) => {
      try {
        const result = await assetsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //get all assets of a company
    app.get("/company-assets/:email", async (req, res) => {
      try {
        const { email: hrEmail } = req.params;
        const result = await assetsCollection.find({ hrEmail }).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: " Internal Server Error" });
      }
    });

    // Get a employees assets
    app.get("/my-assets/:email", async (req, res) => {
      try {
        const { email } = req.params;

        const query = {};
        if (email) {
          query.employeeEmail = email;
        }

        const result = await assignedAssetsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from AssetVerse..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
