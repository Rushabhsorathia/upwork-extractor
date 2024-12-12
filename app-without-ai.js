const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const xlsx = require('xlsx');
const fs = require('fs');

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

        return jobs;
    } catch (error) {
        console.log(`Error extracting jobs: ${error.message}`);
        return [];
    }
}

async function saveToExcel(jobs) {
    if (jobs.length === 0) return;

    const worksheet = xlsx.utils.json_to_sheet(jobs);
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