# Workflow for a New Developer
Let’s say a student named Rahul wants to add a project.

## Step 1 — Fork the repository
He forks the repo to his own GitHub account.

```bash
KELVRIX/student-projects
      ↓
rahul/student-projects
```

## Step 2 — Clone his fork
```bash
git clone https://github.com/rahul/student-projects.git
```

## Step 3 — Create a new project folder

Example:
```bash
student-projects
 └── ai-image-generator
      ├── frontend
      ├── backend
      └── README.md
```

## Step 4 — Commit changes

```bash
git add .
git commit -m "Add AI image generator project"
git push
```

## Step 5 — Create Pull Request
He sends a Pull Request to:

```bash
KELVRIX/student-projects
```
Then you review it.

Workflow:
```bash
Developer
   ↓
Fork repo
   ↓
Add project folder
   ↓
Pull Request
   ↓
Maintainer review
   ↓
Merge
```

# Contribution Rules

1. Create a folder with your project name.
2. Add a README explaining the project.
3. Include setup instructions.
4. Do not modify other projects.
