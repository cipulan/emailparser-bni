import PostalMime from 'postal-mime';

interface Env {
	TELEGRAM_BOT_TOKEN: string;
	TELEGRAM_CHAT_ID: string;
}

export default {
	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
		const telegramBotToken = env.TELEGRAM_BOT_TOKEN;
		const telegramChatId = env.TELEGRAM_CHAT_ID;

		if (!telegramBotToken || !telegramChatId) {
			console.error('Missing Telegram configuration');
			return;
		}

		try {
			const parser = new PostalMime();
			const email = await parser.parse(message.raw);

			// Check for forwarded content
			const forwarded = parseForwardedMail(email.text || email.html || '');

			// Use original details if available, otherwise fall back to current email headers
			const subject = forwarded.subject || email.subject || '(No Subject)';
			// Ensure we don't pick up "Unknown Sender" if forwarded logic fails but we have a real sender
			const from = forwarded.from || (email.from ? `${email.from.name} <${email.from.address}>` : '(Unknown Sender)');
			const date = forwarded.date || '';

			// Extract transaction details if available
			const transactionDetails = parseTransactionDetails(email.html || email.text || '');

			let telegramMessage = `📧 *${from}*\n` +
				`*Subject:* ${escapeMarkdown(subject)}\n`;

			if (date) {
				telegramMessage += `*Date:* ${escapeMarkdown(date)}\n`;
			}

			telegramMessage += `\n` +
				`*Detail Transaksi:*\n` +
				`*Nama Merchant:* ${escapeMarkdown(transactionDetails.namaMerchant)}\n` +
				`*Nominal Transaksi:* ${escapeMarkdown(transactionDetails.nominalTransaksi)}\n` +
				`*Tanggal Transaksi:* ${escapeMarkdown(transactionDetails.tanggalTransaksi)}\n` +
				`*Nomor Kartu Kredit BNI:* ${escapeMarkdown(transactionDetails.nomorKartuKredit)}`;

			await sendToTelegram(telegramBotToken, telegramChatId, telegramMessage);

		} catch (error) {
			console.error('Error parsing email or sending to Telegram:', error);
			// Optional: send error notification to Telegram or log it
		}
	}
};

export function parseTransactionDetails(html: string): { 
	namaMerchant: string, 
	nominalTransaksi: string, 
	tanggalTransaksi: string, 
	nomorKartuKredit: string
} {
	// Defaults
	let namaMerchant = 'N/A';
	let nominalTransaksi = 'N/A';
	let tanggalTransaksi = 'N/A';
	let nomorKartuKredit = 'N/A';

	if (!html) return { namaMerchant, nominalTransaksi, tanggalTransaksi, nomorKartuKredit };

	// Helper to clean extracted text
	const clean = (text: string) => text.replace(/<[^>]*>/g, '').trim();

	// Nama Merchant
	const merchantMatch = html.match(/Nama\s*Merchant\s*<\/td>\s*<td[^>]*>\s*(?::)?\s*([^<]+)/i);
	if (merchantMatch && merchantMatch[1]) namaMerchant = clean(merchantMatch[1]);

	// Nominal Transaksi
	const nominalMatch = html.match(/Nominal\s*Transaksi\s*<\/td>\s*<td[^>]*>\s*(?::)?\s*([^<]+)/i);
	if (nominalMatch && nominalMatch[1]) nominalTransaksi = clean(nominalMatch[1]);

	// Tanggal Transaksi
	const tanggalMatch = html.match(/Tanggal\s*Transaksi\s*<\/td>\s*<td[^>]*>\s*(?::)?\s*([^<]+)/i);
	if (tanggalMatch && tanggalMatch[1]) tanggalTransaksi = clean(tanggalMatch[1]);

	// Nomor Kartu Kredit BNI
	const kartuMatch = html.match(/Nomor\s*Kartu\s*Kredit\s*BNI\s*<\/td>\s*<td[^>]*>\s*(?::)?\s*([^<]+)/i);
	if (kartuMatch && kartuMatch[1]) nomorKartuKredit = clean(kartuMatch[1]);

	return { namaMerchant, nominalTransaksi, tanggalTransaksi, nomorKartuKredit };
}

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

async function sendToTelegram(token: string, chatId: string, text: string) {
	const url = `https://api.telegram.org/bot${token}/sendMessage`;
	const body = {
		chat_id: chatId,
		text: text,
		parse_mode: 'Markdown'
	};

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error(`Telegram API error: ${response.status} ${response.statusText} - ${errorText}`);
	}
}

function escapeMarkdown(text: string): string {
    if (!text) return '';
	// 'Markdown' (v1) supports *bold*, _italic_, [text](url), `code`, ```pre```
    // We should allow some marks if they are intended, but since we are wrapping values, 
    // it's safest to escape everything that could break the format headers.
    // However, for values like "RP. 10.000", * or _ are rare.
	return text.replace(/[_*`\[]/g, '\\$&');
}
