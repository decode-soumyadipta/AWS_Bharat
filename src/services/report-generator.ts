
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, PRODUCTS_BUCKET_NAME, bedrockClient } from '../config/aws-clients';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getTopSellingProducts, getSalesSummary, getDateRangeAnalytics } from './analytics-service';
import type { ProductSalesStats, DateRangeAnalytics } from './analytics-service';
import { getSellerByPhone } from './dynamodb-repository';

const PdfPrinter = require('pdfmake/js/Printer').default;

const NOVA_LITE_MODEL_ID = 'amazon.nova-lite-v1:0';

type ReportType = 'weekly' | 'monthly' | 'custom';

interface ReportRequest {
  phone: string;
  reportType: ReportType;
  language: 'hi' | 'mr' | 'en';
  customStartDate?: string; 
  customEndDate?: string;   
}

interface ReportResult {
  success: boolean;
  pdfUrl?: string;        
  s3Key?: string;         
  voiceSummary?: string;  
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
  confirmedOrders: number;
  pendingOrders: number;
  rejectedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
  confirmedRevenue: number;
  pendingRevenue: number;
  averageOrderValue: number;
  topProducts: ProductSalesStats[];
  dateRangeAnalytics: DateRangeAnalytics | null;
  recommendations: string[];
  generatedAt: string;
}

export async function generateReport(request: ReportRequest): Promise<ReportResult> {
  const { phone, reportType, language, customStartDate, customEndDate } = request;

  try {
    console.log(`📊 Generating ${reportType} report for ${phone}`);

    const seller = await getSellerByPhone(phone);
    const sellerId = seller ? seller.PK.replace('SELLER#', '') : phone;
    const sellerName = seller?.name || 'Seller';

    const { startDate, endDate, dateLabel, dateQuery } = getDateRange(reportType, customStartDate, customEndDate);

    const [topProducts, salesSummary, dateRangeData] = await Promise.all([
      getTopSellingProducts(sellerId, 10, undefined, phone).catch(() => [] as ProductSalesStats[]),
      getSalesSummary(sellerId, undefined, phone).catch(() => ({
        totalOrders: 0, confirmedOrders: 0, pendingOrders: 0, rejectedOrders: 0, cancelledOrders: 0,
        totalRevenue: 0, confirmedRevenue: 0, pendingRevenue: 0,
        averageOrderValue: 0, topProduct: null, topProducts: [], timeRange: '30d',
      })),
      getDateRangeAnalytics(sellerId, dateQuery, phone).catch(() => null),
    ]);

    const recommendations = await generateRecommendations(
      sellerName, topProducts, salesSummary, dateRangeData, language
    );

    const reportData: ReportData = {
      sellerName,
      sellerPhone: phone,
      reportType,
      dateLabel,
      startDate,
      endDate,
      totalOrders: dateRangeData?.totalOrders ?? salesSummary.totalOrders,
      confirmedOrders: dateRangeData?.confirmedOrders ?? salesSummary.confirmedOrders,
      pendingOrders: dateRangeData?.pendingOrders ?? salesSummary.pendingOrders,
      rejectedOrders: dateRangeData?.rejectedOrders ?? salesSummary.rejectedOrders,
      cancelledOrders: dateRangeData?.cancelledOrders ?? salesSummary.cancelledOrders,
      totalRevenue: dateRangeData?.totalRevenue ?? salesSummary.totalRevenue,
      confirmedRevenue: dateRangeData?.confirmedRevenue ?? salesSummary.confirmedRevenue,
      pendingRevenue: dateRangeData?.pendingRevenue ?? salesSummary.pendingRevenue,
      averageOrderValue: salesSummary.averageOrderValue,
      topProducts,
      dateRangeAnalytics: dateRangeData,
      recommendations,
      generatedAt: new Date().toISOString(),
    };

    const pdfBuffer = await buildPdf(reportData, language);

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

    const pdfUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: PRODUCTS_BUCKET_NAME, Key: s3Key }),
      { expiresIn: 86400 }
    );

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

function getDateRange(
  reportType: ReportType,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string; dateLabel: string; dateQuery: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); 

  if (reportType === 'custom' && customStart && customEnd) {
    return {
      startDate: customStart,
      endDate: customEnd,
      dateLabel: `${customStart} to ${customEnd}`,
      dateQuery: customStart, 
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

async function buildPdf(data: ReportData, _language: 'hi' | 'mr' | 'en'): Promise<Buffer> {
  const labels = {
    title: 'Vyapar Vaani - Business Report',
    seller: 'Seller',
    phone: 'Phone',
    period: 'Period',
    generated: 'Generated',
    orderSummary: 'Order Summary',
    confirmedOrders: 'Confirmed Orders',
    confirmedRevenue: 'Confirmed Revenue',
    avgOrder: 'Avg. Order Value',
    pendingOrders: 'Pending Orders',
    pendingRevenue: 'Pending Revenue',
    rejectedOrders: 'Rejected',
    cancelledOrders: 'Cancelled',
    totalOrders: 'Total Orders',
    topProducts: 'Top Products (Confirmed Sales)',
    productName: 'Product',
    orders: 'Orders',
    quantity: 'Qty Sold',
    revenue: 'Revenue (Rs)',
    recommendations: 'Recommendations',
    noData: 'No data available for this period.',
    currency: 'Rs ',
  };

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

  const recommendationItems = data.recommendations.length > 0
    ? data.recommendations.map((r, i) => `${i + 1}. ${r}`)
    : [labels.noData];

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],

    content: [

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

      {
        text: labels.orderSummary,
        fontSize: 16,
        bold: true,
        color: '#2C3E50',
        margin: [0, 0, 0, 10],
      },
      {
        table: {
          widths: ['*', '*', '*'],
          body: [
            [
              { text: labels.confirmedOrders, fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
              { text: labels.confirmedRevenue, fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
              { text: labels.avgOrder, fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
            ],
            [
              { text: `${data.confirmedOrders}`, fontSize: 22, bold: true, color: '#27AE60', alignment: 'center', border: [false, false, false, false] },
              { text: `${labels.currency}${data.confirmedRevenue.toFixed(0)}`, fontSize: 22, bold: true, color: '#27AE60', alignment: 'center', border: [false, false, false, false] },
              { text: `${labels.currency}${data.averageOrderValue.toFixed(0)}`, fontSize: 22, bold: true, color: '#2980B9', alignment: 'center', border: [false, false, false, false] },
            ],
          ],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 10],
      },

      ...(data.pendingOrders > 0 || data.rejectedOrders > 0 || data.cancelledOrders > 0 ? [{
        table: {
          widths: ['*', '*', '*', '*'],
          body: [
            [
              { text: labels.totalOrders, fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
              { text: labels.pendingOrders, fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
              { text: labels.rejectedOrders, fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
              { text: labels.cancelledOrders, fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
            ],
            [
              { text: `${data.totalOrders}`, fontSize: 16, bold: true, color: '#2C3E50', alignment: 'center', border: [false, false, false, false] },
              { text: `${data.pendingOrders}`, fontSize: 16, bold: true, color: '#F39C12', alignment: 'center', border: [false, false, false, false] },
              { text: `${data.rejectedOrders}`, fontSize: 16, bold: true, color: '#E74C3C', alignment: 'center', border: [false, false, false, false] },
              { text: `${data.cancelledOrders}`, fontSize: 16, bold: true, color: '#95A5A6', alignment: 'center', border: [false, false, false, false] },
            ],
          ],
        },
        layout: 'noBorders',
        margin: [0, 0, 0, 5] as [number, number, number, number],
      }] : []),
      ...(data.pendingRevenue > 0 ? [{
        text: `Pending Revenue: ${labels.currency}${data.pendingRevenue.toFixed(0)} (awaiting confirmation)`,
        fontSize: 10,
        color: '#F39C12',
        italics: true,
        alignment: 'center' as const,
        margin: [0, 0, 0, 15] as [number, number, number, number],
      }] : [{ text: '', margin: [0, 0, 0, 15] as [number, number, number, number] }]),

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

  const vfsFonts = require('pdfmake/build/vfs_fonts');

  const printer = new PdfPrinter({
    Roboto: {
      normal: Buffer.from(vfsFonts['Roboto-Regular.ttf'], 'base64'),
      bold: Buffer.from(vfsFonts['Roboto-Medium.ttf'], 'base64'),
      italics: Buffer.from(vfsFonts['Roboto-Italic.ttf'], 'base64'),
      bolditalics: Buffer.from(vfsFonts['Roboto-MediumItalic.ttf'], 'base64'),
    },
  });

  const pdfDoc = await printer.createPdfKitDocument(docDefinition);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}

async function generateRecommendations(
  sellerName: string,
  topProducts: ProductSalesStats[],
  salesSummary: { totalOrders: number; confirmedOrders: number; pendingOrders: number; confirmedRevenue: number; totalRevenue: number; averageOrderValue: number; topProduct: string | null },
  dateRangeData: DateRangeAnalytics | null,
  language: 'hi' | 'mr' | 'en'
): Promise<string[]> {
  try {
    const productList = topProducts.map(p => `${p.productName}: ${p.totalOrders} orders, Rs ${p.totalRevenue}`).join('\n');
    const langName = language === 'hi' ? 'Hindi' : language === 'mr' ? 'Marathi' : 'English';

    const prompt = `You are a rural Indian business advisor. Based on this seller's data, give exactly 4 short, actionable recommendations in ${langName} (use Devanagari script for Hindi/Marathi).

Seller: ${sellerName}
Confirmed Orders: ${salesSummary.confirmedOrders}
Pending Orders: ${salesSummary.pendingOrders}
Total Orders: ${salesSummary.totalOrders}
Confirmed Revenue: Rs ${salesSummary.confirmedRevenue}
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

function buildVoiceSummary(data: ReportData, language: 'hi' | 'mr' | 'en'): string {
  if (language === 'hi' || language === 'mr') {
    const parts: string[] = [];

    if (data.reportType === 'weekly') {
      parts.push(`${data.sellerName} ji, aapki hafte ki report taiyaar hai.`);
    } else if (data.reportType === 'monthly') {
      parts.push(`${data.sellerName} ji, aapki mahine ki report taiyaar hai.`);
    } else {
      parts.push(`${data.sellerName} ji, aapki report taiyaar hai.`);
    }

    if (data.confirmedOrders > 0) {
      parts.push(`Confirmed orders: ${data.confirmedOrders}, revenue ${data.confirmedRevenue} rupaye.`);
    }
    if (data.pendingOrders > 0) {
      parts.push(`Pending orders: ${data.pendingOrders}, ${data.pendingRevenue} rupaye pending hain.`);
    }
    if (data.totalOrders === 0) {
      parts.push('Is samay mein abhi koi order nahi aaya.');
    }

    if (data.topProducts.length > 0) {
      parts.push(`Sabse zyada bikne wala product ${data.topProducts[0].productName} raha.`);
    }

    parts.push('PDF report bhej raha hoon, ismein poori detail aur suggestions hain.');

    return parts.join(' ');
  }

  const parts: string[] = [];
  parts.push(`${data.sellerName}, your ${data.reportType} report is ready.`);

  if (data.confirmedOrders > 0) {
    parts.push(`Confirmed: ${data.confirmedOrders} orders, ${data.confirmedRevenue} rupees revenue.`);
  }
  if (data.pendingOrders > 0) {
    parts.push(`Pending: ${data.pendingOrders} orders (${data.pendingRevenue} rupees awaiting confirmation).`);
  }
  if (data.totalOrders === 0) {
    parts.push('No orders recorded for this period yet.');
  }

  if (data.topProducts.length > 0) {
    parts.push(`Your top selling product was ${data.topProducts[0].productName}.`);
  }

  parts.push('Sending you the detailed PDF report now with recommendations.');

  return parts.join(' ');
}

export function detectReportIntent(message: string): { reportType: ReportType; customStart?: string; customEnd?: string } | null {
  const lower = message.toLowerCase().trim();

  const weeklyHindi = /हफ्ते\s*(का|की)\s*(हिसाब|रिपोर्ट|report)|weekly\s*report|सप्ताह\s*(का|की)\s*(हिसाब|रिपोर्ट)|पिछले\s*हफ्ते/i;
  const monthlyHindi = /महीने\s*(का|की)\s*(हिसाब|रिपोर्ट|report)|monthly\s*report|पिछले\s*महीने\s*(का|की)\s*(हिसाब|रिपोर्ट)|माह\s*(का|की)\s*(रिपोर्ट|हिसाब)/i;
  const genericReport = /रिपोर्ट|report|pdf|हिसाब|बिक्री\s*(की|का)\s*रिपोर्ट|business\s*report|sales\s*report|bikri\s*report/i;

  if (weeklyHindi.test(lower) || weeklyHindi.test(message)) {
    return { reportType: 'weekly' };
  }

  if (monthlyHindi.test(lower) || monthlyHindi.test(message)) {
    return { reportType: 'monthly' };
  }

  const dateRange = message.match(/(\d{4}-\d{2}-\d{2})\s*(se|to|से|तक|-)\s*(\d{4}-\d{2}-\d{2})/i);
  if (dateRange && genericReport.test(lower)) {
    return { reportType: 'custom', customStart: dateRange[1], customEnd: dateRange[3] };
  }

  if (genericReport.test(lower) || genericReport.test(message)) {
    return { reportType: 'weekly' };
  }

  return null;
}
