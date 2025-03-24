export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/stars') {
      const repo = url.searchParams.get('repo')
      const group = (url.searchParams.get('group') as 'day' | 'week' | 'month') || 'day'

      if (!repo) {
        return new Response('Repo parameters is required', { status: 400 })
      }

      const [stars, log] = await fetchStars(repo, env)
      const timeData = generateStarsOverTimeData(stars, group)
      const html = generateHTML(repo, timeData, group, log)

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
        },
      })
    } else {
      return new Response(index(), {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
        },
      })
    }
  },
} satisfies ExportedHandler<Env>

interface ResponseData {
  starred_at: string
}

async function fetchStars(repo: string, env: Env): Promise<[Date[], string]> {
  const apiUrl = `https://api.github.com/repos/${repo}/stargazers`
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
  const logLines: string[] = []

  const log = (msg: string) => {
    logLines.push(msg)
    console.log(msg)
  }

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
        log(`WARNING: GitHub API hit pagination limit, stopping (url: ${url})`)
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

  const concurrency = 20
  log(`Fetching stars for ${repo} with concurrency=${concurrency}...`)
  const startTime = Date.now()
  await Promise.all([...Array(concurrency)].map(() => getPages()))
  const endTime = Date.now()
  log(`Fetched ${stars.length} stars in ${((endTime - startTime) / 1000).toFixed(2)} seconds`)
  log(`pages cached ${cached}, pages downloaded ${downloaded}`)
  return [stars, logLines.join('\n')]
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

function generateHTML(repo: string, timeData: Point[], group: 'day' | 'week' | 'month', log: string): string {
  const totalStars = timeData.reduce((sum, day) => sum + day.count, 0)
  const chartData = JSON.stringify(timeData)

  return htmlPage(
    `GitHub Stars - ${repo}`,
    `
  <h1>GitHub Stars — ${repo}</h1>
  <div>
    <a href="/">Home</a>
  </div>
  <div>Total Stars: ${totalStars}</div>
  <div>
    <form action="/stars" method="get">
      <div>
        <label for="repo">Repository (owner/name):</label>
        <input type="text" id="repo" name="repo" required value="${repo}">
      </div>
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
  <div>
    <h3>Log</h3>
    <pre>${log}</pre>
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
            label: 'New Stars per ${group}',
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
    const submit = () => {
      document.querySelector('form').submit()
    }
    document.getElementById('repo').addEventListener('change', submit)
    document.getElementById('group').addEventListener('change', submit)
  </script>
`,
  )
}

const index = () =>
  htmlPage(
    'GitHub Stars',
    `
  <h1>GitHub Stars</h1>
  <div>
    <form action="/stars" method="get">
      <div>
        <label for="repo">Repository (owner/name):</label>
        <input type="text" id="repo" name="repo"  placeholder="e.g., pydantic/pydantic-ai" required>
      </div>
      <div>
        <label for="group">Group by</label>
        <select id="group" name="group">
          <option value="day">Day</option>
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
      </div>
      <button type="submit">Submit</button>
    </form>
  </div>`,
  )

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      margin: 0;
      padding: 10px 20px;
    }
    h1 {
      margin: 0;
    }
    .chart-container {
      max-width: 1200px;
    }
    input, select {
      margin: 4px 0 8px;
      padding: 8px;
      border: 1px solid #ddd;
      border-radius: 4px;
      width: 200px;
      display: block;
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`
}
