require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
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
      "http://localhost:5173",
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
        if (!user || user.role !== "employee") {
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
        if (!user || user.role !== "hr") {
          return res.status(403).send({ message: "Only HR actions" });
        }
        next();
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    };

    //User related APIs
    // post new users
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

    // get  user
    app.get("/users", verifyJWT, async (req, res) => {
      try {
        const result = await usersCollection.findOne({ email: req.tokenEmail });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Get specific user by email (used by Profile.jsx)
    app.get("/users/:email", verifyJWT, async (req, res) => {
      try {
        const email = req.params.email;

        // Security: make sure requested email matches token email
        if (email !== req.tokenEmail) {
          return res.status(403).send({ message: "Forbidden Access" });
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ message: "User not found" });
        }

        res.send(user);
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

    // Package related APIs

    // Get packages
    app.get("/packages", verifyJWT, verifyHR, async (req, res) => {
      try {
        const result = await packagesCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Payment Endpoints

    app.post(
      "/create-checkout-session",
      verifyJWT,
      verifyHR,
      async (req, res) => {
        // try {
        const paymentInfo = req.body;

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: paymentInfo?.name,
                },
                unit_amount: paymentInfo?.price * 100,
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo?.customer?.email,
          mode: "payment",
          metadata: {
            packageId: paymentInfo?.packageId,
            customer: paymentInfo?.customer?.name,
            employeeLimit: paymentInfo?.employeeLimit,
          },
          success_url: `${process.env.CLIENT_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/upgrade-package`,
        });

        res.send({ url: session.url });
      }
    );

    app.post("/payment-success", verifyJWT, verifyHR, async (req, res) => {
      try {
        const { sessionId } = req.body;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const hrQuery = { email: session?.customer_email };
        const hr = await usersCollection.findOne(hrQuery);

        const packageData = await packagesCollection.findOne({
          _id: new ObjectId(session.metadata.packageId),
        });

        const existingPayment = await paymentsCollection.findOne({
          transitionId: session.payment_intent,
        });

        if (session.payment_status === "paid" && packageData) {
          const orderInfo = {
            hrEmail: session.customer_email,
            packageName: packageData?.name,
            transitionId: session.payment_intent,
            amount: session.amount_total / 100,
            employeeLimit: Number(session.metadata.employeeLimit),
            paymentDate: new Date().toISOString(),
            status: "completed",
          };

          if (existingPayment) {
            return res.send({
              transitionId: session.payment_intent,
              message: "Payment already recorded",
            });
          }

          const result = await paymentsCollection.insertOne(orderInfo);

          const increaseLimit =
            hr.packageLimit + Number(session.metadata.employeeLimit);

          const hrUpdate = {
            $set: { packageLimit: increaseLimit },
          };

          // Increase Package Limit of HR
          await usersCollection.updateOne(hrQuery, hrUpdate);
          return res.send({
            transitionId: session.payment_intent,
            orderId: result.insertedId,
          });
        }
        return res.send({
          transitionId: session.payment_intent,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Get payment history
    app.get("/payments/:email", verifyJWT, verifyHR, async (req, res) => {
      try {
        const { email } = req.params;

        const result = await paymentsCollection
          .find({ hrEmail: email })
          .toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.send({ message: "Internal Server Error" });
      }
    });

    // Asset Related APIs

    // Get  assets
    app.get("/assets", verifyJWT, async (req, res) => {
      try {
        const result = await assetsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //get  assets of a company
    app.get("/company-assets/:email", verifyJWT, verifyHR, async (req, res) => {
      try {
        const { email: hrEmail } = req.params;
        const result = await assetsCollection
          .find({ hrEmail })
          .sort({})
          .toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: " Internal Server Error" });
      }
    });

    // Get employees assets
    app.get(
      "/my-assets/:email",
      verifyJWT,
      verifyEmployee,
      async (req, res) => {
        try {
          const { email } = req.tokenEmail;

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
      }
    );

    // Edit asset
    app.patch("/assets/:id", verifyJWT, verifyHR, async (req, res) => {
      try {
        const updateData = req.body;
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };

        const update = {
          $set: updateData,
        };

        const asset = await assetsCollection.findOne({ _id: new ObjectId(id) });

        const result = await assetsCollection.updateOne(query, update);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Asset Not Found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // assign asset
    app.patch("/assign-asset/:id", verifyJWT, verifyHR, async (req, res) => {
      try {
        const updateData = req.body;
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };

        const update = {
          $set: updateData,
        };

        const asset = await assetsCollection.findOne({ _id: new ObjectId(id) });

        if (asset.availableQuantity === 0) {
          return res.status(404).send({ message: "Asset Not Available" });
        }

        const result = await assetsCollection.updateOne(query, update);

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: "Asset Not Found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Post asset
    app.post("/assets", verifyJWT, verifyHR, async (req, res) => {
      try {
        const assetData = req.body;
        const result = await assetsCollection.insertOne(assetData);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Delete asset
    app.delete("/asset/:id", verifyJWT, verifyHR, async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const result = await assetsCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Asset Not Found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Request Related APIs

    // Post assigned asset (direct assignment from HR)
    app.post("/assigned-assets", verifyJWT, verifyHR, async (req, res) => {
      try {
        const assignmentData = req.body;
        const employeeEmail = assignmentData.employeeEmail;
        const assetId = assignmentData.assetId;
        const hrEmail = assignmentData.hrEmail;

        const existingAssets = await assignedAssetsCollection.findOne({
          employeeEmail,
          assetId,
        });

        if (existingAssets) {
          return res.status(409).send({ message: "Asset Already Assigned" });
        }

        // Check if employee already exists in the company (team)
        const existingEmployeeAffiliation =
          await employeeAffiliationsCollection.findOne({
            employeeEmail,
            hrEmail,
          });

        // Get HR info
        const hr = await usersCollection.findOne({ email: hrEmail });

        if (hr.packageLimit === 0) {
          return res.status(409).send({
            message:
              "Your package limit has been reached. Please upgrade or purchase a new package to continue.",
          });
        }

        if (!hr) {
          return res.status(404).send({ message: "HR not found" });
        }

        const updatePackageLimit = hr.packageLimit - 1;

        // Only increment currentEmployees if this is a NEW employee for the HR
        let updateCurrentEmployees = hr.currentEmployees;
        if (!existingEmployeeAffiliation) {
          updateCurrentEmployees = hr.currentEmployees + 1;
        }

        // Update HR package limit and employee count
        const updateHR = {
          $set: {
            packageLimit: updatePackageLimit,
            currentEmployees: updateCurrentEmployees,
          },
        };

        await usersCollection.updateOne({ email: hrEmail }, updateHR);
        const result = await assignedAssetsCollection.insertOne(assignmentData);

        // Only add to employee affiliations if this is a NEW employee
        if (!existingEmployeeAffiliation) {
          const employeeAffiliationData = {
            employeeName: assignmentData.employeeName,
            employeeEmail: employeeEmail,
            companyName: assignmentData.companyName,
            companyLogo: hr?.companyLogo,
            hrEmail: hrEmail,
            affiliationDate: new Date().toISOString(),
            status: "active",
          };
          await employeeAffiliationsCollection.insertOne(
            employeeAffiliationData
          );
        }

        res.status(201).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Post asset request
    app.post("/asset-requests", verifyJWT, verifyEmployee, async (req, res) => {
      try {
        const requestData = req.body;
        requestData.requestDate = new Date().toISOString();
        requestData.approvalDate = null;
        requestData.requestStatus = "pending";

        const existingRequest = await requestsCollection.findOne({
          assetId: requestData.assetId,
          requesterEmail: req.tokenEmail,
        });

        if (existingRequest) {
          return res.status(409).send({ message: "Already Requested" });
        }

        const result = await requestsCollection.insertOne(requestData);
        res.status(201).send(result);
      } catch (error) {
        console.error(error);
        req.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Get asset requests
    app.get("/asset-requests/:email", verifyJWT, verifyHR, async (req, res) => {
      try {
        const { email } = req.params;
        const { limit = 0, skip = 0 } = req.query;

        const query = {};

        if (email) {
          query.hrEmail = email;
        }

        const result = await requestsCollection
          .find(query)
          .sort({ requestDate: -1 })
          .limit(Number(limit))
          .skip(Number(skip))
          .toArray();

        const count = await requestsCollection.countDocuments({
          hrEmail: email,
        });

        res.send({ requests: result, total: count });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Approve employee request
    app.patch(
      "/approve-employee-requests/:id",
      verifyJWT,
      verifyHR,
      async (req, res) => {
        try {
          const { requestStatus, assetId } = req.body;
          const { id } = req.params;
          const query = { _id: new ObjectId(id) };
          const assetQuery = {
            _id: new ObjectId(assetId),
          };

          const update = {
            $set: { requestStatus, approvalDate: new Date().toISOString() },
          };

          const asset = await assetsCollection.findOne(assetQuery);

          const latestQuantity = asset.availableQuantity - 1;

          const assetUpdate = {
            $set: { availableQuantity: latestQuantity },
          };

          const request = await requestsCollection.findOne(query);

          const assignedAssetListData = {
            assetId: asset?._id.toString(),
            assetName: asset?.productName,
            assetImage: asset?.productImage,
            assetType: asset?.productType,
            employeeEmail: request?.requesterEmail,
            employeeName: request?.requesterName,
            hrEmail: request?.hrEmail,
            companyName: request?.companyName,
            assignmentDate: new Date().toISOString(),
            returnDate: null,
            status: "assigned",
          };

          const hr = await usersCollection.findOne({ email: request?.hrEmail });

          const employeeAffiliationsListData = {
            employeeName: request?.requesterName,
            employeeEmail: request?.requesterEmail,
            companyName: request?.companyName,
            companyLogo: hr?.companyLogo,
            hrEmail: request?.hrEmail,
            affiliationDate: new Date().toISOString(),
            status: "active",
          };

          if (!request) {
            return res.status(404).send({ message: "Request Not Found" });
          }
          if (request.requestStatus === "approved") {
            return res
              .status(409)
              .send({ message: "Request Already Approved" });
          }

          const existingAssignedAssetCollection =
            await assignedAssetsCollection.findOne({
              assetId: asset?._id.toString(),
              employeeEmail: request?.requesterEmail,
              status: "assigned",
            });

          if (existingAssignedAssetCollection) {
            return res.status(409).send({ message: "Already Assigned" });
          }

          const existingEmployeeAffiliation =
            await employeeAffiliationsCollection.findOne({
              employeeEmail: request?.requesterEmail,
              hrEmail: request?.hrEmail,
            });

          const updatePackageLimit = hr.packageLimit - 1;

          // Only increment currentEmployees if this is a NEW employee for the HR
          let updateCurrentEmployees = hr.currentEmployees;
          if (!existingEmployeeAffiliation) {
            updateCurrentEmployees = hr.currentEmployees + 1;
          }

          const updateHR = {
            $set: {
              packageLimit: updatePackageLimit,
              currentEmployees: updateCurrentEmployees,
            },
          };

          if (hr.packageLimit === 0) {
            return res.status(409).send({
              message:
                "Your Package has been Finished, Buy Package for Approve Assignment",
            });
          }

          await usersCollection.updateOne({ email: hr?.email }, updateHR);
          await assetsCollection.updateOne(assetQuery, assetUpdate);
          await assignedAssetsCollection.insertOne(assignedAssetListData);
          const result = await requestsCollection.updateOne(query, update);

          if (!existingEmployeeAffiliation) {
            await employeeAffiliationsCollection.insertOne(
              employeeAffiliationsListData
            );
          }

          res.send(result);
        } catch (error) {
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // Reject employee request
    app.patch(
      "/reject-employee-requests/:id",
      verifyJWT,
      verifyHR,
      async (req, res) => {
        try {
          const { requestStatus } = req.body;
          const { id } = req.params;
          const query = { _id: new ObjectId(id) };

          const update = {
            $set: {
              requestStatus,
            },
          };

          const existingRequest = await requestsCollection.findOne(query);

          if (!existingRequest) {
            return res.status(404).send({ message: "Request Not Found" });
          }

          if (existingRequest.requestStatus !== "pending") {
            return res.status(409).send({ message: "Already Processed" });
          }

          const result = await requestsCollection.updateOne(query, update);
          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // Employee Related Data

    // Get a HRs employee
    app.get("/my-employees/:email", verifyJWT, verifyHR, async (req, res) => {
      try {
        // 1 Get all asset assignments for this HR
        const employeeAffiliations = await employeeAffiliationsCollection
          .find({ hrEmail: req.tokenEmail })
          .toArray();

        const assignedAssets = await assignedAssetsCollection
          .find({ hrEmail: req.tokenEmail })
          .toArray();

        // 2 Get unique employee emails
        const employeeEmails = [
          ...new Set(employeeAffiliations.map((e) => e.employeeEmail)),
        ];

        if (employeeEmails.length === 0) {
          return res.send([]);
        }

        // 3 Get employee details from usersCollection
        const employees = await usersCollection
          .find({
            email: { $in: employeeEmails },
          })
          .toArray();

        // 4 Count assets for each employee
        const result = employees.map((emp) => {
          const assetCount = assignedAssets.filter(
            (a) => a.employeeEmail === emp.email
          ).length;

          return {
            name: emp.name,
            email: emp.email,
            image: emp.profileImage,
            assetCount,
          };
        });

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Delete an employee
    app.delete(
      "/my-employees/:email",
      verifyJWT,
      verifyHR,
      async (req, res) => {
        try {
          const { email: employeeEmail } = req.params;
          const result = await employeeAffiliationsCollection.deleteOne({
            employeeEmail,
          });

          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // Get employees of a company
    app.get(
      "/my-team/:companyName",
      verifyJWT,
      verifyEmployee,
      async (req, res) => {
        try {
          const { companyName } = req.params;

          //1 Get employeeAffiliations by company Name
          const employeeAffiliations = await employeeAffiliationsCollection
            .find({ companyName })
            .toArray();

          // 2 Get the employees email
          const employeeEmails = [
            ...new Set(employeeAffiliations.map((e) => e.employeeEmail)),
          ];

          if (employeeEmails.length === 0) {
            return res.send([]);
          }

          // 3 Get HRs email
          const hrRecord = await employeeAffiliationsCollection.findOne({
            companyName,
          });

          const hrEmail = hrRecord?.hrEmail;

          const memberQuery = {
            $or: [{ email: { $in: employeeEmails } }, { email: hrEmail }],
          };

          // 4 Get members data from usersCollection
          const members = await usersCollection.find(memberQuery).toArray();

          const result = members.map((e) => {
            return {
              name: e.name,
              email: e.email,
              photo: e.profileImage,
              position: e.role,
              upcomingBirthday: e.dateOfBirth,
            };
          });
          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // Get a member of a company
    app.get(
      "/my-companies/:email",
      verifyJWT,
      verifyEmployee,
      async (req, res) => {
        try {
          const { email: employeeEmail } = req.params;

          const myCompanies = await employeeAffiliationsCollection
            .find({ employeeEmail })
            .toArray();

          const result = myCompanies.map((company) => {
            return {
              companyName: company.companyName,
            };
          });

          res.send(result);
        } catch (error) {
          console.error(error);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

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
  res.send("Hello Asset managment...");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

export default app;
