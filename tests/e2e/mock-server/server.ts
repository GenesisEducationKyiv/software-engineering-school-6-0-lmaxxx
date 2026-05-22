import express from 'express';

const app = express();

app.get('/repos/:owner/:repo', (req, res) => {
  if (req.params.owner === 'ratelimited') {
    return void res.status(429).json({ message: 'API rate limit exceeded' });
  }
  if (req.params.owner === 'notfound') {
    return void res.status(404).json({ message: 'Not Found' });
  }
  res.json({ full_name: `${req.params.owner}/${req.params.repo}` });
});

app.get('/repos/:owner/:repo/releases/latest', (req, res) => {
  if (req.params.owner === 'ratelimited') {
    return void res.status(429).json({ message: 'API rate limit exceeded' });
  }
  if (req.params.repo === 'noreleases') {
    return void res.status(404).json({ message: 'Not Found' });
  }
  res.json({ tag_name: 'v1.0.0' });
});

app.listen(4000, () => console.log('Mock GitHub API listening on :4000'));
