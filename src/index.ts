/**
 * GitHub Stars Graph Worker
 *
 * Displays a graph of new GitHub stars over time for a specified repository.
 */

interface StarData {
  starred_at: string
}

async function fetchStars(owner: string, repo: string, env: Env): Promise<StarData[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/stargazers`
  const headers = new Headers({
    Accept: 'application/vnd.github.v3.star+json',
    'User-Agent': 'starline',
  })

  // Add authorization header if GitHub API key is available
  if (env.GITHUB_TOKEN) {
    headers.set('Authorization', `token ${env.GITHUB_TOKEN}`)
  }

  const stars: StarData[] = []
  let page = 1
  let hasMorePages = true

  while (hasMorePages) {
    const response = await fetch(`${apiUrl}?page=${page}&per_page=100`, { headers })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`GitHub API error: ${response.status}`)
    }

    const data = await response.json<StarData[]>()
    if (data.length === 0) {
      hasMorePages = false
    } else {
      stars.push(...data)
      page++
    }
  }

  return stars
}

function generateStarsOverTimeData(stars: StarData[]): { date: string; count: number }[] {
  // Sort stars by date
  stars.sort((a, b) => new Date(a.starred_at).getTime() - new Date(b.starred_at).getTime())

  // Group stars by day
  const starLine = new Map<string, number>()

  for (const star of stars) {
    console.log({ star })
    const date = new Date(star.starred_at).toISOString().split('T')[0] // YYYY-MM-DD
    const count = (starLine.get(date) || 0) + 1
    starLine.set(date, count)
  }

  // Convert to array of { date, count } objects
  return Array.from(starLine.entries()).map(([date, count]) => ({ date, count }))
}

function generateHTML(owner: string, repo: string, timeData: { date: string; count: number }[]): string {
  const totalStars = timeData.reduce((sum, day) => sum + day.count, 0)
  const chartData = JSON.stringify(timeData)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Stars - ${owner}/${repo}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      max-width: 1000px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      text-align: center;
    }
    .chart-container {
      position: relative;
      height: 400px;
      width: 100%;
    }
    .repo-info {
      text-align: center;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <h1>GitHub Stars Over Time</h1>
  <div class="repo-info">
    <h2>${owner}/${repo}</h2>
    <p>Total Stars: ${totalStars}</p>
  </div>
  <div class="chart-container">
    <canvas id="starsChart"></canvas>
  </div>

  <script>
    const timeData = ${chartData};

    // Prepare data for Chart.js
    const labels = timeData.map(d => d.date);
    const counts = timeData.map(d => d.count);

    // Create cumulative data
    const cumulativeCounts = [];
    let total = 0;
    for (const count of counts) {
      total += count;
      cumulativeCounts.push(total);
    }

    const ctx = document.getElementById('starsChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'New Stars Per Week',
            data: counts,
            backgroundColor: 'rgba(54, 162, 235, 0.2)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1,
            yAxisID: 'y-axis-1',
          },
          {
            label: 'Cumulative Stars',
            data: cumulativeCounts,
            backgroundColor: 'rgba(255, 99, 132, 0.2)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1,
            yAxisID: 'y-axis-2',
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            title: {
              display: true,
              text: 'Date'
            }
          },
          'y-axis-1': {
            type: 'linear',
            position: 'left',
            title: {
              display: true,
              text: 'New Stars'
            },
            beginAtZero: true
          },
          'y-axis-2': {
            type: 'linear',
            position: 'right',
            title: {
              display: true,
              text: 'Total Stars'
            },
            beginAtZero: true,
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    });
  </script>
</body>
</html>`
}

function generateFormHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Stars Graph</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      text-align: center;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
    label {
      font-weight: bold;
    }
    input {
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
    }
    button {
      padding: 10px;
      background-color: #0366d6;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }
    button:hover {
      background-color: #0255b3;
    }
    .example {
      margin-top: 20px;
      color: #666;
    }
  </style>
</head>
<body>
  <h1>GitHub Stars Graph</h1>
  <form action="/stars" method="get">
    <div>
      <label for="owner">Repository Owner:</label>
      <input type="text" id="owner" name="owner" required placeholder="e.g., facebook">
    </div>
    <div>
      <label for="repo">Repository Name:</label>
      <input type="text" id="repo" name="repo" required placeholder="e.g., react">
    </div>
    <button type="submit">Generate Graph</button>
  </form>
  <div class="example">
    <p>Example: To see stars for github.com/cloudflare/workers-sdk</p>
    <p>Owner: cloudflare</p>
    <p>Repository: workers-sdk</p>
  </div>
</body>
</html>`
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    try {
      // Handle stars page
      if (url.pathname === '/stars') {
        const owner = url.searchParams.get('owner')
        const repo = url.searchParams.get('repo')

        if (!owner || !repo) {
          return new Response('Owner and repo parameters are required', { status: 400 })
        }

        const stars = await fetchStars(owner, repo, env)
        const timeData = generateStarsOverTimeData(stars)
        const html = generateHTML(owner, repo, timeData)

        return new Response(html, {
          headers: {
            'Content-Type': 'text/html;charset=UTF-8',
          },
        })
      }

      // Home page - show form
      const formHtml = generateFormHTML()
      return new Response(formHtml, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
        },
      })
    } catch (error) {
      console.error('Error:', error)
      return new Response(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
    }
  },
} satisfies ExportedHandler<Env>
