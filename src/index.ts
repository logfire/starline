/**
 * GitHub Stars Graph Worker
 *
 * Displays a graph of new GitHub stars over time for a specified repository.
 */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    try {
      // Handle stars page
      if (url.pathname === '/stars') {
        const owner = url.searchParams.get('owner')
        const repo = url.searchParams.get('repo')
        const group = (url.searchParams.get('group') as 'day' | 'week' | 'month') || 'day'

        if (!owner || !repo) {
          return new Response('Owner and repo parameters are required', { status: 400 })
        }

        const stars = await fetchStars(owner, repo, env)
        const timeData = generateStarsOverTimeData(stars, group)
        const html = generateHTML(owner, repo, timeData, group)

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

interface ResponseData {
  starred_at: string
}

async function fetchStars(owner: string, repo: string, env: Env): Promise<Date[]> {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/stargazers`
  const headers = new Headers({
    Accept: 'application/vnd.github.v3.star+json',
    'User-Agent': 'starline',
    Authorization: `token ${env.GITHUB_TOKEN}`,
  })

  const stars: Date[] = []
  const extend = (rawStars: string[]) => stars.push(...rawStars.map(parseDate))
  let page = 0
  let cached = 0
  let downloaded = 0
  let ongoing = true

  async function getPages(): Promise<void> {
    while (ongoing) {
      page++
      const url = `${apiUrl}?page=${page}&per_page=100`
      let cachedRawStars = await env.GITHUB_CACHE.get<string[]>(url, 'json')
      if (cachedRawStars) {
        cached++
        extend(cachedRawStars)
        continue
      }
      if (!ongoing) {
        break
      }
      const response = await fetch(url, { headers })
      if (response.status == 422) {
        console.warn('GitHub API hit pagination limit, stopping')
        ongoing = false
        break
      }
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`GitHub API error: GET ${url} -> ${response.status}, response:\n${text}`)
      }
      // console.log('headers:', Object.fromEntries(response.headers.entries()))

      const data = await response.json<ResponseData[]>()
      if (data.length === 0) {
        ongoing = false
      } else {
        downloaded++
        const rawStars = data.map(({ starred_at }) => starred_at)
        if (rawStars.length === 100) {
          await env.GITHUB_CACHE.put(url, JSON.stringify(rawStars), {
            expirationTtl: 86400 * 30, // 30 days
          })
        }
        extend(rawStars)
      }
    }
  }

  const concurrency = 10
  console.log(`Fetching stars for ${owner}/${repo} with concurrency=${concurrency}...`)
  const startTime = Date.now()
  await Promise.all([...Array(concurrency)].map(() => getPages()))
  const endTime = Date.now()
  console.log(`Fetched ${stars.length} stars in ${((endTime - startTime) / 1000).toFixed(2)} seconds`)
  console.log(`cached ${cached} pages, downloaded ${downloaded} pages`)
  return stars
}

function parseDate(dateString: string): Date {
  const d = new Date(dateString)
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date string: ${dateString}`)
  }
  return d
}

interface Point {
  date: string
  count: number
}

function generateStarsOverTimeData(stars: Date[], group: 'day' | 'week' | 'month'): Point[] {
  // Sort stars by date
  stars.sort((a, b) => a.getTime() - b.getTime())

  // Group stars by day
  const starLine = new Map<string, number>()

  for (const starDate of stars) {
    const date = dateTrunc(starDate, group)
    const key = date.toISOString().split('T')[0] // YYYY-MM-DD
    const count = (starLine.get(key) || 0) + 1
    starLine.set(key, count)
  }

  // Convert to array of { date, count } objects
  const line = Array.from(starLine.entries()).map(([date, count]) => ({ date, count }))
  // remove the last entry
  line.pop()
  return line
}

function dateTrunc(date: Date, interval: 'day' | 'week' | 'month'): Date {
  const grouped = new Date(date)
  grouped.setHours(0, 0, 0, 0)
  if (interval === 'month') {
    grouped.setDate(1)
  } else if (interval === 'week') {
    const day = date.getDay() // Get the current day of the week (0 for Sunday, 1 for Monday, etc.)
    const diff = (day === 0 ? -6 : 1) - day // Calculate difference to nearest Monday
    grouped.setDate(date.getDate() + diff)
  }
  return grouped
}

function generateHTML(owner: string, repo: string, timeData: Point[], group: 'day' | 'week' | 'month'): string {
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
  <div>
    <a href="/">Back to Form</a>
  </div>
  <div style="margin-top: 10px">
    <form action="/stars" method="get">
    
      <div>
        <label for="owner">Repository Owner:</label>
        <input type="text" id="owner" name="owner" required value="${owner}">
      </div>
      <div>
        <label for="repo">Repository Name:</label>
        <input type="text" id="repo" name="repo" required value="${repo}">
      </div>
      <button type="submit">Update</button>
      <div>
        <label for="group">Group by</label>
        <select id="group" name="group">
          <option value="day"${group == 'day' ? ' selected' : ''}>Day</option>
          <option value="week"${group == 'week' ? ' selected' : ''}>Week</option>
          <option value="month"${group == 'month' ? ' selected' : ''}>Month</option>
        </select>
      </div>
    </form>
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
    // auto submit the form when group changes
    document.getElementById('group').addEventListener('change', () => {
      document.querySelector('form').submit()
    })
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
      <input type="text" id="owner" name="owner" required placeholder="e.g., pydantic">
    </div>
    <div>
      <label for="repo">Repository Name:</label>
      <input type="text" id="repo" name="repo" required placeholder="e.g., pydantic-ai">
    </div>
    <div>
      <label for="group">Group by</label>
      <select id="group" name="group">
        <option value="day">Day</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
      </select>
    </div>
    <button type="submit">Generate Graph</button>
  </form>
</body>
</html>`
}
