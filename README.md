
---

#  Server Side `README.md`

# AssetManagment — Corporate Asset Management System (Server)

This is the backend API for **AssetManagment**, a corporate asset management platform built using Node.js, Express, MongoDB, and Firebase JWT authentication.


---

##  Purpose
- Handle authentication & authorization
- Manage assets, requests, employees & packages
- Enforce HR role permissions
- Process Stripe payments
- Serve secure REST APIs for client

---

##  Tech Stack

### Backend
- Node.js
- Express.js
- MongoDB
- Firebase Admin SDK
- JWT Authentication
- Stripe
- CORS
- Dotenv

---

##  NPM Packages Used
- express
- mongodb
- firebase-admin
- cors
- dotenv
- stripe

---

##  Database Collections
- users
- assets
- requests
- assignedAssets
- employeeAffiliations
- packages
- payments

---

##  Authentication & Middleware
- `verifyJWT` → validates Firebase token
- `verifyHR` → HR-only routes protection

---

##  Environment Variables (`.env`)
```env
PORT=3000
MONGODB_URI=YOUR_MONGODB_CONNECTION_STRING
FB_SERVICE_KEY=BASE64_ENCODED_FIREBASE_SERVICE_ACCOUNT
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET
