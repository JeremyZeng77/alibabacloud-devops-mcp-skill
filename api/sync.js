// api/sync.js
// Vercel Serverless Function to trigger GitHub Actions workflow dispatch securely

export default async function handler(req, res) {
    // Enable CORS for frontend requests
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    // Retrieve GitHub Token from Environment Variables (Secrets)
    const token = process.env.GH_PAT;
    if (!token) {
        return res.status(500).json({ ok: false, error: 'Environment variable GH_PAT is not configured on Vercel.' });
    }
    
    try {
        const url = 'https://api.github.com/repos/JeremyZeng77/alibabacloud-devops-mcp-skill/actions/workflows/sync-data.yml/dispatches';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github+json',
                'User-Agent': 'Vercel-Serverless-Sync',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ref: 'main' })
        });
        
        if (response.status === 204) {
            return res.status(200).json({ ok: true, message: 'Sync workflow triggered successfully!' });
        } else {
            const errText = await response.text();
            return res.status(response.status).json({ ok: false, error: errText });
        }
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
}
