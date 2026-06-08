require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// 1. Initialize the Express App
const app = express();

// 2. Middleware
app.use(cors()); // Lets your React frontend connect safely
app.use(express.json()); // Tells Express to understand JSON data sent from the frontend

// 3. Connect to Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// 4. Create a "Test" Route to verify the connection
app.get('/api/health', async (req, res) => {
    try {
        // Let's test the database by quickly asking for profiles!
        const { data, error } = await supabase.from('profiles').select('*').limit(1);
        
        if (error) throw error;

        res.status(200).json({ 
            message: "Backend is running and Supabase is connected! 🚀", 
            dbStatus: data ? "Database responding" : "Database empty" 
        });
    } catch (err) {
        res.status(500).json({ error: "Connection failed", details: err.message });
    }
});

// 5. Start the Server
const PORT = process.env.PORT || 5000;
// Registration Route: Handles Auth creation + Public Profile generation
app.post('/api/auth/signup', async (req, res) => {
    // 1. Extract credentials and profile fields from the frontend request body
    const { email, password, username, displayName, role, course, academicYear, collegeId } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ error: "Email, password, and username are strictly required." });
    }

    try {
        // 2. Register the user inside Supabase's secure Auth system
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email,
            password
        });

        // Catch validation errors (e.g., password too short, invalid email format)
        if (authError) throw authError;

        // 3. If Auth succeeded, use the generated UUID to populate our public profiles table
        if (authData?.user) {
            const { error: profileError } = await supabase
                .from('profiles')
                .insert([
                    {
                        id: authData.user.id, // The binding link: matching the Auth UUID
                        username: username.toLowerCase().trim(),
                        display_name: displayName || username,
                        role: role || 'Member',
                        course: course,
                        academic_year: academicYear,
                        college_id: collegeId,
                        avatar_url: `https://api.dicebear.com/7.x/initials/svg?seed=${username}` // Dynamic avatar placeholder
                    }
                ]);

            // If profile creation fails, throw error to handle cleanup or alerting
            if (profileError) throw profileError;
        }

        // 4. Respond with success status and user data structure
        res.status(201).json({
            message: "Registration successful! Account and profile initialized.",
            user: {
                id: authData.user.id,
                email: authData.user.email,
                username: username
            }
        });

    } catch (error) {
        console.error("Signup Pipeline Error:", error.message);
        res.status(400).json({ error: error.message });
    }
});
app.listen(PORT, () => {
    console.log(`Server is blazing fast and running on http://localhost:${PORT}`);
});