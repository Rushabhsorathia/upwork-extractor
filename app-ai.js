const OpenAI = require('openai');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Enable stealth mode
puppeteer.use(StealthPlugin());

// Add recaptcha handling if needed
puppeteer.use(
    RecaptchaPlugin({
        provider: { id: '2captcha', token: '' }
    })
);

const EXCEL_FILE = 'upwork_jobs.xlsx';
const BASE_URL = 'https://www.upwork.com/nx/search/jobs/?q=php%20laravel&sort=recency';
const openai = new OpenAI({
    apiKey: '', // enter api key 
});
// Your professional profile details
const MY_PROFILE = {
    name: "Rushabh Sorathiya",
    years_experience: 5,
    key_skills: [
        'PHP',
        'Laravel',
        'JavaScript',
        'Vue.js',
        'React.js',
        'Node.js',
        'MySQL',
        'MongoDB',
        'WordPress',
        'API Development',
        'AWS'
    ],
    projects: [
        'Built RESTful APIs with Laravel/Core PHP',
        'Developed dynamic UIs using Vue.js and React.js',
        'Created custom WordPress themes and plugins',
        'Implemented real-time features with Node.js',
        'Designed scalable database architectures for applications',
        'Built e-commerce platforms with payment integrations',
        'Created SaaS platforms with user management systems',
        'Developed CRM systems with third-party integrations'
    ],
    hourly_rate: "$40-50",
    availability: "Full-time, 40+ hours/week",
    timezone: "UTC+5:30 (IST)"
};


async function generateProposalWithGPT(jobDetails) {
    try {
        const prompt = `
Generate a personalized Upwork proposal for this job:

Job Details:
- Title: ${jobDetails['Job Title']}
- Description: ${jobDetails['Description']}
- Skills Required: ${jobDetails['Skills']}
- Budget: ${jobDetails['Budget']}
- Duration: ${jobDetails['Duration']}
- Experience Level: ${jobDetails['Experience Level']}

My Profile:
- Name: ${MY_PROFILE.name}
- Experience: ${MY_PROFILE.years_experience}+ years in web development
- Key Skills: ${MY_PROFILE.key_skills.join(', ')}
- Notable Projects: ${MY_PROFILE.projects.join('; ')}
- Availability: ${MY_PROFILE.availability}
- Timezone: ${MY_PROFILE.timezone}
- Portfolio: ${MY_PROFILE.portfolio}

Requirements for the proposal:
1. Start with a personalized greeting
2. Show clear understanding of their specific project needs
3. Mention relevant experience that directly relates to their requirements
4. Provide a brief approach to their project
5. Include a specific question about their project requirements
6. Keep it professional but conversational
7. End with a clear call to action
8. Keep total length under 300 words
9. Make it engaging and stand out from generic proposals

Please format the proposal with clear paragraphs and spacing.`;

        const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "gpt-3.5-turbo",
            temperature: 0.7,
            max_tokens: 600
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('Error generating proposal:', error);
        return 'Error generating proposal. Please check OpenAI API configuration.';
    }
}



async function initBrowser() {
    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-web-security',
            '--disable-features=IsolateOrigins',
            '--disable-site-isolation-trials',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080',
            '--start-maximized'
        ],
        ignoreHTTPSErrors: true,
        defaultViewport: null
    });

    return browser;
}

async function createPage(browser) {
    const page = await browser.newPage();
    
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false
        });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin' },
                { name: 'Chrome PDF Viewer' },
                { name: 'Native Client' }
            ]
        });
    });

    return page;
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function navigateToPage(page, url, pageNum) {
    console.log(`Navigating to page ${pageNum}`);
    
    try {
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
        await client.send('Network.clearBrowserCache');

        let retries = 3;
        while (retries > 0) {
            try {
                await page.goto(url, {
                    waitUntil: 'networkidle0',
                    timeout: 90000
                });

                await page.waitForSelector('article.job-tile', {
                    timeout: 30000
                });

                const jobsExist = await page.evaluate(() => {
                    return document.querySelectorAll('article.job-tile').length > 0;
                });

                if (jobsExist) {
                    console.log('Page loaded successfully');
                    return true;
                }

                console.log('No jobs found, retrying...');
                retries--;
                await wait(5000);
            } catch (error) {
                console.log(`Navigation attempt failed: ${error.message}`);
                retries--;
                if (retries === 0) throw error;
                await wait(5000);
            }
        }

        return false;
    } catch (error) {
        console.log(`Navigation failed: ${error.message}`);
        return false;
    }
}

async function extractJobData(page) {
    try {
        const jobs = await page.evaluate(() => {
            const jobCards = document.querySelectorAll('article.job-tile');
            return Array.from(jobCards).map(card => {
                const getTextContent = (selector) => {
                    const element = card.querySelector(selector);
                    return element ? element.textContent.trim() : '';
                };

                return {
                    'Job Title': getTextContent('.job-tile-title a'),
                    'Job URL': card.querySelector('.job-tile-title a')?.href || '',
                    'Description': getTextContent('[data-test="UpCLineClamp JobDescription"] p'),
                    'Posted Time': getTextContent('[data-test="job-pubilshed-date"]').replace('Posted', '').trim(),
                    'Budget': getTextContent('.job-tile-info-list'),
                    'Experience Level': getTextContent('[data-test="experience-level"]'),
                    'Duration': getTextContent('[data-test="duration-label"]').replace('Est. Time:', '').trim(),
                    'Skills': Array.from(card.querySelectorAll('[data-test="TokenClamp JobAttrs"] button'))
                        .map(skill => skill.textContent.trim())
                        .join(', '),
                    'Scraped At': new Date().toLocaleString()
                };
            });
        });

        // Generate proposals using ChatGPT
        console.log('Generating proposals for jobs...');
        for (let job of jobs) {
            console.log(`Generating proposal for: ${job['Job Title']}`);
            job['Generated Proposal'] = await generateProposalWithGPT(job);
            // Add delay to respect API rate limits
            await wait(1000);
        }

        return jobs;
    } catch (error) {
        console.log(`Error extracting jobs: ${error.message}`);
        return [];
    }
}

async function saveToExcel(jobs) {
    if (jobs.length === 0) return;

    // Set column widths
    const worksheet = xlsx.utils.json_to_sheet(jobs);
    const columnWidths = {
        A: 40,  // Job Title
        B: 50,  // Job URL
        C: 80,  // Description
        D: 15,  // Posted Time
        E: 20,  // Budget
        F: 15,  // Experience Level
        G: 30,  // Duration
        H: 50,  // Skills
        I: 20,  // Scraped At
        J: 100  // Generated Proposal
    };

    worksheet['!cols'] = Object.keys(columnWidths).map(key => ({
        width: columnWidths[key]
    }));

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Upwork Jobs');
    xlsx.writeFile(workbook, EXCEL_FILE);
    console.log(`Saved ${jobs.length} jobs to Excel`);
}

async function main() {
    let browser;
    try {
        browser = await initBrowser();
        const page = await createPage(browser);
        let allJobs = [];
        let pageNum = 1;

        while (pageNum <= 2) {
            const url = pageNum === 1 ? BASE_URL : `${BASE_URL}&page=${pageNum}`;
            const success = await navigateToPage(page, url, pageNum);

            if (!success) {
                console.log(`Failed to load page ${pageNum}`);
                break;
            }

            // Wait for dynamic content
            await wait(3000);

            const jobs = await extractJobData(page);
            console.log(`Found ${jobs.length} jobs on page ${pageNum}`);

            if (jobs.length === 0) {
                break;
            }

            allJobs = allJobs.concat(jobs);
            await saveToExcel(allJobs);

            pageNum++;
            await wait(5000); // Delay between pages
        }

        console.log(`Scraping completed. Total jobs: ${allJobs.length}`);
    } catch (error) {
        console.log(`Error: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

main().catch(console.error);