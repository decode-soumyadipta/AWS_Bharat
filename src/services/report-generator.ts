/**
 * Report Generator Service
 * 
 * Generates PDF business reports for sellers using pdfmake.
 * Supports weekly, monthly, and custom date-range reports.
 * Reports include: sales summary, top products, revenue trends,
 * market price comparison, and AI-powered recommendations.
 * 
 * Generated PDFs are uploaded to S3 and delivered via WhatsApp document message.
 */

import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, PRODUCTS_BUCKET_NAME, bedrockClient } from '../config/aws-clients';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getTopSellingProducts, getSalesSummary, getDateRangeAnalytics } from './analytics-service';
import type { ProductSalesStats, DateRangeAnalytics } from './analytics-service';
import { getSellerByPhone } from './dynamodb-repository';

// pdfmake uses CommonJS — import via require
// In v0.3.5+, PdfPrinter class is at pdfmake/js/Printer (default export)
const PdfPrinter = require('pdfmake/js/Printer').default;

const NOVA_LITE_MODEL_ID = 'amazon.nova-lite-v1:0';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReportType = 'weekly' | 'monthly' | 'custom';

export interface ReportRequest {
  phone: string;
  reportType: ReportType;
  language: 'hi' | 'mr' | 'en';
  customStartDate?: string; // YYYY-MM-DD
  customEndDate?: string;   // YYYY-MM-DD
}

export interface ReportResult {
  success: boolean;
  pdfUrl?: string;        // Pre-signed S3 URL for WhatsApp delivery
  s3Key?: string;         // S3 object key
  voiceSummary?: string;  // Spoken summary for voice message
  error?: string;
}

interface ReportData {
  sellerName: string;
  sellerPhone: string;
  reportType: ReportType;
  dateLabel: string;
  startDate: string;
  endDate: string;
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  topProducts: ProductSalesStats[];
  dateRangeAnalytics: DateRangeAnalytics | null;
  recommendations: string[];
  generatedAt: string;
}

// ── Fonts (pdfmake built-in Roboto) ─────────────────────────────────────────
// Loaded lazily inside buildPdf to avoid import errors in test environments

// ── Main Export: Generate Report ────────────────────────────────────────────

/**
 * Generate a PDF business report for a seller.
 * 
 * @param request - Report parameters (phone, type, language, custom dates)
 * @returns ReportResult with pre-signed URL and voice summary
 */
export async function generateReport(request: ReportRequest): Promise<ReportResult> {
  const { phone, reportType, language, customStartDate, customEndDate } = request;

  try {
    console.log(`📊 Generating ${reportType} report for ${phone}`);

    // 1. Look up seller
    const seller = await getSellerByPhone(phone);
    const sellerId = seller ? seller.PK.replace('SELLER#', '') : phone;
    const sellerName = seller?.name || 'Seller';

    // 2. Calculate date range
    const { startDate, endDate, dateLabel, dateQuery } = getDateRange(reportType, customStartDate, customEndDate);

    // 3. Fetch analytics data in parallel
    const [topProducts, salesSummary, dateRangeData] = await Promise.all([
      getTopSellingProducts(sellerId, 10, undefined, phone).catch(() => [] as ProductSalesStats[]),
      getSalesSummary(sellerId, undefined, phone).catch(() => ({
        totalOrders: 0, totalRevenue: 0, averageOrderValue: 0, topProduct: null, timeRange: '30d',
      })),
      getDateRangeAnalytics(sellerId, dateQuery, phone).catch(() => null),
    ]);

    // 4. Generate AI recommendations
    const recommendations = await generateRecommendations(
      sellerName, topProducts, salesSummary, dateRangeData, language
    );

    // 5. Assemble report data
    const reportData: ReportData = {
      sellerName,
      sellerPhone: phone,
      reportType,
      dateLabel,
      startDate,
      endDate,
      totalOrders: dateRangeData?.totalOrders ?? salesSummary.totalOrders,
      totalRevenue: dateRangeData?.totalRevenue ?? salesSummary.totalRevenue,
      averageOrderValue: salesSummary.averageOrderValue,
      topProducts,
      dateRangeAnalytics: dateRangeData,
      recommendations,
      generatedAt: new Date().toISOString(),
    };

    // 6. Build PDF
    const pdfBuffer = await buildPdf(reportData, language);

    // 7. Upload to S3
    const s3Key = `reports/${phone}/${reportType}-${startDate}-to-${endDate}.pdf`;
    await s3Client.send(new PutObjectCommand({
      Bucket: PRODUCTS_BUCKET_NAME,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      Metadata: {
        phone,
        reportType,
        generatedAt: reportData.generatedAt,
      },
    }));

    // 8. Generate pre-signed URL (valid 24 hours)
    const pdfUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: PRODUCTS_BUCKET_NAME, Key: s3Key }),
      { expiresIn: 86400 }
    );

    // 9. Generate voice summary
    const voiceSummary = buildVoiceSummary(reportData, language);

    console.log(`✅ Report generated: ${s3Key}`);

    return {
      success: true,
      pdfUrl,
      s3Key,
      voiceSummary,
    };
  } catch (error) {
    console.error('❌ Report generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ── Date Range Helper ───────────────────────────────────────────────────────

function getDateRange(
  reportType: ReportType,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string; dateLabel: string; dateQuery: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); // IST offset

  if (reportType === 'custom' && customStart && customEnd) {
    return {
      startDate: customStart,
      endDate: customEnd,
      dateLabel: `${customStart} to ${customEnd}`,
      dateQuery: customStart, // getDateRangeAnalytics uses single date or keyword
    };
  }

  if (reportType === 'monthly') {
    const firstOfMonth = new Date(ist.getFullYear(), ist.getMonth(), 1);
    const startDate = firstOfMonth.toISOString().split('T')[0];
    const endDate = ist.toISOString().split('T')[0];
    return {
      startDate,
      endDate,
      dateLabel: ist.toLocaleDateString('hi-IN', { month: 'long', year: 'numeric' }),
      dateQuery: 'last_month',
    };
  }

  // Default: weekly
  const weekAgo = new Date(ist);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const startDate = weekAgo.toISOString().split('T')[0];
  const endDate = ist.toISOString().split('T')[0];
  return {
    startDate,
    endDate,
    dateLabel: `${startDate} to ${endDate}`,
    dateQuery: 'last_week',
  };
}

// ── PDF Builder ─────────────────────────────────────────────────────────────

async function buildPdf(data: ReportData, language: 'hi' | 'mr' | 'en'): Promise<Buffer> {
  const isHindi = language === 'hi' || language === 'mr';

  // Labels based on language
  const labels = isHindi ? {
    title: 'व्यापार वाणी — बिज़नेस रिपोर्ट',
    seller: 'विक्रेता',
    phone: 'फ़ोन',
    period: 'अवधि',
    generated: 'रिपोर्ट तैयार',
    summary: 'सारांश',
    totalOrders: 'कुल ऑर्डर',
    totalRevenue: 'कुल रेवेन्यू',
    avgOrder: 'औसत ऑर्डर वैल्यू',
    topProducts: 'शीर्ष उत्पाद',
    productName: 'उत्पाद',
    orders: 'ऑर्डर',
    quantity: 'मात्रा',
    revenue: 'रेवेन्यू (₹)',
    recommendations: 'सुझाव',
    noData: 'इस अवधि में कोई डेटा उपलब्ध नहीं है।',
    currency: '₹',
  } : {
    title: 'Vyapar Vaani — Business Report',
    seller: 'Seller',
    phone: 'Phone',
    period: 'Period',
    generated: 'Generated',
    summary: 'Summary',
    totalOrders: 'Total Orders',
    totalRevenue: 'Total Revenue',
    avgOrder: 'Avg. Order Value',
    topProducts: 'Top Products',
    productName: 'Product',
    orders: 'Orders',
    quantity: 'Quantity',
    revenue: 'Revenue (₹)',
    recommendations: 'Recommendations',
    noData: 'No data available for this period.',
    currency: '₹',
  };

  // Build product table rows
  const productRows: any[][] = [
    [
      { text: '#', bold: true, fillColor: '#4A90D9', color: '#FFFFFF' },
      { text: labels.productName, bold: true, fillColor: '#4A90D9', color: '#FFFFFF' },
      { text: labels.orders, bold: true, fillColor: '#4A90D9', color: '#FFFFFF' },
      { text: labels.quantity, bold: true, fillColor: '#4A90D9', color: '#FFFFFF' },
      { text: labels.revenue, bold: true, fillColor: '#4A90D9', color: '#FFFFFF' },
    ],
  ];

  if (data.topProducts.length > 0) {
    data.topProducts.forEach((p, i) => {
      productRows.push([
        { text: `${i + 1}`, alignment: 'center' },
        p.productName || 'Unknown',
        { text: `${p.totalOrders}`, alignment: 'center' },
        { text: `${p.totalQuantity}`, alignment: 'center' },
        { text: `${labels.currency}${p.totalRevenue.toFixed(0)}`, alignment: 'right' },
      ]);
    });
  } else {
    productRows.push([{ text: labels.noData, colSpan: 5, alignment: 'center', italics: true }, {}, {}, {}, {}]);
  }

  // Build recommendations list
  const recommendationItems = data.recommendations.length > 0
    ? data.recommendations.map((r, i) => `${i + 1}. ${r}`)
    : [labels.noData];

  // pdfmake document definition
  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],

    content: [
      // Header
      {
        text: labels.title,
        fontSize: 22,
        bold: true,
        color: '#2C3E50',
        alignment: 'center',
        margin: [0, 0, 0, 5],
      },
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: '#4A90D9' }],
        margin: [0, 0, 0, 15],
      },

      // Seller Info
      {
        columns: [
          {
            width: '*',
            text: [
              { text: `${labels.seller}: `, bold: true },
              data.sellerName,
            ],
          },
          {
            width: '*',
            text: [
              { text: `${labels.phone}: `, bold: true },
              data.sellerPhone,
            ],
            alignment: 'right',
          },
        ],
        margin: [0, 0, 0, 5],
      },
      {
        columns: [
          {
            width: '*',
            text: [
              { text: `${labels.period}: `, bold: true },
              data.dateLabel,
            ],
          },
          {
            width: '*',
            text: [
              { text: `${labels.generated}: `, bold: true },
              new Date(data.generatedAt).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              }),
            ],
            alignment: 'right',
          },
        ],
        margin: [0, 0, 0, 20],
      },

      // Summary Box
      {
        text: labels.summary,
        fontSize: 16,
        bold: true,
        color: '#2C3E50',
        margin: [0, 0, 0, 10],
      },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: labels.totalOrders, fontSize: 10, color: '#7F8C8D' },
              { text: `${data.totalOrders}`, fontSize: 24, bold: true, color: '#2C3E50' },
            ],
            alignment: 'center',
          },
          {
            width: '*',
            stack: [
              { text: labels.totalRevenue, fontSize: 10, color: '#7F8C8D' },
              { text: `${labels.currency}${data.totalRevenue.toFixed(0)}`, fontSize: 24, bold: true, color: '#27AE60' },
            ],
            alignment: 'center',
          },
          {
            width: '*',
            stack: [
              { text: labels.avgOrder, fontSize: 10, color: '#7F8C8D' },
              { text: `${labels.currency}${data.averageOrderValue.toFixed(0)}`, fontSize: 24, bold: true, color: '#2980B9' },
            ],
            alignment: 'center',
          },
        ],
        margin: [0, 0, 0, 25],
      },

      // Top Products Table
      {
        text: labels.topProducts,
        fontSize: 16,
        bold: true,
        color: '#2C3E50',
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          headerRows: 1,
          widths: [30, '*', 60, 60, 80],
          body: productRows,
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#DDDDDD',
          vLineColor: () => '#DDDDDD',
          paddingLeft: () => 8,
          paddingRight: () => 8,
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 25],
      },

      // Recommendations
      {
        text: labels.recommendations,
        fontSize: 16,
        bold: true,
        color: '#2C3E50',
        margin: [0, 0, 0, 10],
      },
      ...recommendationItems.map(r => ({
        text: r,
        fontSize: 11,
        color: '#34495E',
        margin: [10, 0, 0, 6],
        lineHeight: 1.4,
      })),

      // Footer
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#DDDDDD' }],
        margin: [0, 25, 0, 10],
      },
      {
        text: 'Powered by Vyapar Vaani — AI Business Assistant for Rural India',
        fontSize: 9,
        color: '#95A5A6',
        alignment: 'center',
        italics: true,
      },
    ],

    defaultStyle: {
      fontSize: 11,
      lineHeight: 1.3,
    },
  };

  // Generate PDF buffer
  // pdfmake/build/vfs_fonts in npm exports font buffers directly (not under pdfMake.vfs)
  const vfsFonts = require('pdfmake/build/vfs_fonts');
  
  const printer = new PdfPrinter({
    Roboto: {
      normal: Buffer.from(vfsFonts['Roboto-Regular.ttf'], 'base64'),
      bold: Buffer.from(vfsFonts['Roboto-Medium.ttf'], 'base64'),
      italics: Buffer.from(vfsFonts['Roboto-Italic.ttf'], 'base64'),
      bolditalics: Buffer.from(vfsFonts['Roboto-MediumItalic.ttf'], 'base64'),
    },
  });

  // In pdfmake 0.3.5+, createPdfKitDocument returns a Promise
  const pdfDoc = await printer.createPdfKitDocument(docDefinition);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}

// ── AI Recommendations ──────────────────────────────────────────────────────

async function generateRecommendations(
  sellerName: string,
  topProducts: ProductSalesStats[],
  salesSummary: { totalOrders: number; totalRevenue: number; averageOrderValue: number; topProduct: string | null },
  dateRangeData: DateRangeAnalytics | null,
  language: 'hi' | 'mr' | 'en'
): Promise<string[]> {
  try {
    const productList = topProducts.map(p => `${p.productName}: ${p.totalOrders} orders, ₹${p.totalRevenue}`).join('\n');
    const langName = language === 'hi' ? 'Hindi' : language === 'mr' ? 'Marathi' : 'English';

    const prompt = `You are a rural Indian business advisor. Based on this seller's data, give exactly 4 short, actionable recommendations in ${langName} (use Devanagari script for Hindi/Marathi).

Seller: ${sellerName}
Total Orders: ${salesSummary.totalOrders}
Total Revenue: ₹${salesSummary.totalRevenue}
Top Product: ${salesSummary.topProduct || 'None yet'}
Products:
${productList || 'No products sold yet'}

Rules:
- Each recommendation max 2 sentences
- Focus on: pricing strategy, product diversification, seasonal opportunities, customer retention
- Use real numbers from the data
- If no sales data, suggest getting started strategies
- Write in ${langName} only (Devanagari for Hindi/Marathi)
- NO bullet points or special characters
- Return exactly 4 lines, one recommendation per line`;

    const command = new InvokeModelCommand({
      modelId: NOVA_LITE_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { max_new_tokens: 400, temperature: 0.7 },
      }),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.output.message.content[0].text.trim();

    const lines = text.split('\n').filter((l: string) => l.trim().length > 0).slice(0, 4);
    return lines.length > 0 ? lines : getDefaultRecommendations(language);
  } catch (error) {
    console.warn('AI recommendations failed, using defaults:', error);
    return getDefaultRecommendations(language);
  }
}

function getDefaultRecommendations(language: 'hi' | 'mr' | 'en'): string[] {
  if (language === 'hi' || language === 'mr') {
    return [
      'अपने सबसे ज़्यादा बिकने वाले उत्पादों का स्टॉक हमेशा तैयार रखें।',
      'मंडी भाव देखकर अपनी कीमतें अपडेट करते रहें — इससे ज़्यादा ग्राहक आएंगे।',
      'नए मौसमी उत्पाद जोड़ें — ग्राहकों को वैराइटी पसंद आती है।',
      'अपना मार्केटप्लेस लिंक ज़्यादा से ज़्यादा लोगों के साथ शेयर करें।',
    ];
  }
  return [
    'Keep top-selling products well stocked to avoid missing sales.',
    'Update prices based on current mandi rates to attract more customers.',
    'Add seasonal products to your catalog for variety.',
    'Share your marketplace link with more people to grow your customer base.',
  ];
}

// ── Voice Summary Builder ───────────────────────────────────────────────────

function buildVoiceSummary(data: ReportData, language: 'hi' | 'mr' | 'en'): string {
  if (language === 'hi' || language === 'mr') {
    const parts: string[] = [];
    
    if (data.reportType === 'weekly') {
      parts.push(`${data.sellerName} जी, आपकी हफ्ते की रिपोर्ट तैयार है।`);
    } else if (data.reportType === 'monthly') {
      parts.push(`${data.sellerName} जी, आपकी महीने की रिपोर्ट तैयार है।`);
    } else {
      parts.push(`${data.sellerName} जी, आपकी रिपोर्ट तैयार है।`);
    }

    if (data.totalOrders > 0) {
      parts.push(`इस अवधि में आपके कुल ${data.totalOrders} ऑर्डर आए और कुल रेवेन्यू ${data.totalRevenue} रुपये रही।`);
    } else {
      parts.push('इस अवधि में अभी कोई ऑर्डर नहीं आया।');
    }

    if (data.topProducts.length > 0) {
      parts.push(`आपका सबसे ज़्यादा बिकने वाला उत्पाद ${data.topProducts[0].productName} रहा।`);
    }

    parts.push('PDF रिपोर्ट भेज रहा हूँ, इसमें पूरी डिटेल और सुझाव हैं।');

    return parts.join(' ');
  }

  // English
  const parts: string[] = [];
  parts.push(`${data.sellerName}, your ${data.reportType} report is ready.`);

  if (data.totalOrders > 0) {
    parts.push(`You had ${data.totalOrders} orders with total revenue of ${data.totalRevenue} rupees.`);
  } else {
    parts.push('No orders recorded for this period yet.');
  }

  if (data.topProducts.length > 0) {
    parts.push(`Your top selling product was ${data.topProducts[0].productName}.`);
  }

  parts.push('Sending you the detailed PDF report now with recommendations.');

  return parts.join(' ');
}

// ── Intent Detection ────────────────────────────────────────────────────────

/**
 * Detect if a user message is requesting a business report.
 * Returns the report type if detected, null otherwise.
 */
export function detectReportIntent(message: string): { reportType: ReportType; customStart?: string; customEnd?: string } | null {
  const lower = message.toLowerCase().trim();

  // Hindi/Devanagari triggers
  const weeklyHindi = /हफ्ते\s*(का|की)\s*(हिसाब|रिपोर्ट|report)|weekly\s*report|सप्ताह\s*(का|की)\s*(हिसाब|रिपोर्ट)|पिछले\s*हफ्ते/i;
  const monthlyHindi = /महीने\s*(का|की)\s*(हिसाब|रिपोर्ट|report)|monthly\s*report|पिछले\s*महीने\s*(का|की)\s*(हिसाब|रिपोर्ट)|माह\s*(का|की)\s*(रिपोर्ट|हिसाब)/i;
  const genericReport = /रिपोर्ट|report|pdf|हिसाब|बिक्री\s*(की|का)\s*रिपोर्ट|business\s*report|sales\s*report|bikri\s*report/i;

  if (weeklyHindi.test(lower) || weeklyHindi.test(message)) {
    return { reportType: 'weekly' };
  }

  if (monthlyHindi.test(lower) || monthlyHindi.test(message)) {
    return { reportType: 'monthly' };
  }

  // Custom date detection (YYYY-MM-DD to YYYY-MM-DD)
  const dateRange = message.match(/(\d{4}-\d{2}-\d{2})\s*(se|to|से|तक|-)\s*(\d{4}-\d{2}-\d{2})/i);
  if (dateRange && genericReport.test(lower)) {
    return { reportType: 'custom', customStart: dateRange[1], customEnd: dateRange[3] };
  }

  // Generic report → default to weekly
  if (genericReport.test(lower) || genericReport.test(message)) {
    return { reportType: 'weekly' };
  }

  return null;
}
