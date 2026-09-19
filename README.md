# FixAI

FixAI is a hostel complaint management platform that helps students report maintenance problems and track them until they are resolved.

We built this project to make the complaint process easier for students and more organized for hostel administrators and service providers.

## Why FixAI?

In many hostels, students have to report issues manually or contact different people for different problems. It can be difficult to know whether a complaint has been received, who is handling it, or when it will be fixed.

FixAI brings these steps together in one platform.

## How it works

A student raises a complaint by providing the details of the problem. The complaint can then be reviewed and categorized before being handled by an admin or warden.

The admin can assign the complaint to a suitable service provider, such as an electrician, plumber, carpenter, cleaner, or other technician.

The service provider can view the assigned complaint, accept the work, set the service charge, and update the complaint status.

The student can then track the progress of the complaint from their account.

```text
Student
   ↓
Raise Complaint
   ↓
Complaint Review & Categorization
   ↓
Admin / Warden
   ↓
Assign Service Provider
   ↓
Service Provider
   ↓
Work & Fee
   ↓
Payment
   ↓
Complaint Resolved
```

## Main Features

### Student

* Create an account and log in
* Raise hostel complaints
* Provide complaint details and category
* Track complaint status
* View previous complaints
* Receive notifications
* Manage profile

### Admin / Warden

* View complaints from students
* Check complaint details
* Assign service providers
* Manage service providers
* Monitor complaint progress
* Manage administrators

### Service Provider

* View assigned complaints
* Accept assigned work
* Set professional charges
* Update work status
* Manage profile

### AI Support

FixAI also uses AI assistance to help with complaint analysis and categorization. This can help identify the type of issue and its priority so that the complaint can be handled more efficiently.

## Technology Used

* HTML
* CSS
* JavaScript
* Node.js
* Express.js
* SQLite
* REST APIs
* JWT Authentication
* Nodemailer / SMTP
* AI-based complaint analysis

## Project Structure

```text
FixAi-Trio/
│
├── public/
│   ├── index.html
│   ├── student.html
│   ├── admin.html
│   ├── support.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
│
├── server.js
├── mailer.js
├── package.json
├── package-lock.json
├── debug-login.js
├── .gitignore
└── README.md
```

## Running the Project

Clone the repository:

```bash
git clone https://github.com/NAVEENMAHAWAR/FixAi-Trio.git
```

Move into the project folder:

```bash
cd FixAi-Trio
```

Install the required packages:

```bash
npm install
```

Create a `.env` file with the required configuration and then start the backend:

```bash
npm run dev
```

The backend will run locally on:

```text
http://localhost:3000
```

## Team

**Team RISERS**

This project is being developed as part of **Avalon OpenHack**.

## Current Status

The project is currently under development. We are working on improving the complaint workflow, AI features, service-provider management, payment flow, and deployment.

## Our Goal

The main idea behind FixAI is simple: make it easier for students to report problems and make it easier for the people responsible for maintenance to manage and resolve those problems.

