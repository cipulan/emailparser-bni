import PostalMime from 'postal-mime';
import * as fs from 'fs';
import * as path from 'path';
import { parseTransactionDetails } from '../src/index';

// Only for testing/mocking the internal function since it's not exported
function parseForwardedMail(content: string): { from?: string, subject?: string, date?: string } {
    let from, subject, date;

    // Normalize content to help with matching
    // Replace <br> with newlines
    const normalized = content.replace(/<br\s*\/?>/gi, '\n');

    // Regex for "From" / "Dari" in forwarded block
    const fromMatch = normalized.match(/(?:Dari|From):\s*(.*?)(?:\r?\n|$)/i);
    if (fromMatch && fromMatch[1]) {
        // Remove HTML tags and extra whitespace
        from = fromMatch[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        // Decode HTML entities (basic ones)
        from = from.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }

    // Regex for "Date" / "Tanggal"
    const dateMatch = normalized.match(/(?:Date|Tanggal|Sent):\s*(.*?)(?:\r?\n|$)/i);
    if (dateMatch && dateMatch[1]) {
        date = dateMatch[1].replace(/<[^>]*>/g, '').trim();
    }

    // Regex for "Subject" - Handle potential multi-line subjects
    // We look for Subject: ... then either To: or Date: or just end of line if it's the last header
    const subjectMatch = normalized.match(/Subject:\s*([\s\S]*?)(?:\r?\n(?:To|Date|Dari|Sent):|\r?\n\r?\n|$)/i);
    if (subjectMatch && subjectMatch[1]) {
        subject = subjectMatch[1].replace(/<[^>]*>/g, '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    }

    return { from, subject, date };
}

async function test() {
    // Test with the Forwarded email
    const emlPath = path.join(process.cwd(), 'Fwd_ Notifikasi Transaksi Kartu MASTERCARDXX6915 di merchant QRIS-Rintisan 16.eml');

    if (!fs.existsSync(emlPath)) {
        console.error(`Error: Could not find email file at ${emlPath}`);
        // Try to list files in current directory to help debug
        console.log('Files in current directory:', fs.readdirSync(process.cwd()));
        process.exit(1);
    }

    console.log(`Reading email from: ${emlPath}`);
    const emlContent = fs.readFileSync(emlPath);

    const parser = new PostalMime();
    const email = await parser.parse(emlContent);

    console.log('Parsing content...');

    // Test Forwarded Headers
    const forwarded = parseForwardedMail(email.text || email.html || '');
    console.log('--- Forwarded Headers ---');
    console.log(JSON.stringify(forwarded, null, 2));

    // Test Transaction Details
    const extracted = parseTransactionDetails(email.html || email.text || '');

    console.log('--- Extracted Data ---');
    console.log(JSON.stringify(extracted, null, 2));
}

test().catch(console.error);
