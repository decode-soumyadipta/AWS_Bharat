
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, PRODUCTS_BUCKET_NAME, bedrockClient } from '../config/aws-clients';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getTopSellingProducts, getSalesSummary, getDateRangeAnalytics } from './analytics-service';
import type { ProductSalesStats, DateRangeAnalytics } from './analytics-service';
import { getSellerByPhone, getCatalogItemsBySeller, getOrdersBySeller } from './dynamodb-repository';
import type { CatalogItem } from '../models/catalog';
import type { Order } from '../models/order';

const PdfPrinter = require('pdfmake/js/Printer').default;

const NOVA_LITE_MODEL_ID = 'amazon.nova-lite-v1:0';

const DEVANAGARI_CONSONANTS: Record<string, string> = {
  'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'ng',
  'च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'ny',
  'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n',
  'त':'t','थ':'th','द':'d','ध':'dh','न':'n',
  'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m',
  'य':'y','र':'r','ल':'l','व':'v',
  'श':'sh','ष':'sh','स':'s','ह':'h',
  'क़':'q','ख़':'kh','ग़':'gh','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f',
};
const DEVANAGARI_VOWELS: Record<string, string> = {
  'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo',
  'ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऋ':'ri',
};
const DEVANAGARI_MATRAS: Record<string, string> = {
  'ा':'a','ि':'i','ी':'ee','ु':'u','ू':'oo',
  'े':'e','ै':'ai','ो':'o','ौ':'au','ृ':'ri',
  '्':'','ं':'n','ः':'h','ँ':'n',
};
const DEVANAGARI_DIGITS: Record<string, string> = {
  '०':'0','१':'1','२':'2','३':'3','४':'4',
  '५':'5','६':'6','७':'7','८':'8','९':'9',
};

function toLatinSafe(text: string): string {
  if (!text) return '';
  if (/^[\x00-\x7F]*$/.test(text)) return text;

  const chars = [...text];
  let result = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1] || '';

    if (DEVANAGARI_CONSONANTS[ch + next]) {
      const c = DEVANAGARI_CONSONANTS[ch + next];
      i++;
      const after = chars[i + 1] || '';
      if (after === '्') { result += c; i++; }
      else if (DEVANAGARI_MATRAS[after] !== undefined) { result += c + DEVANAGARI_MATRAS[after]; i++; }
      else { result += c + 'a'; }
      continue;
    }
    if (DEVANAGARI_CONSONANTS[ch]) {
      const c = DEVANAGARI_CONSONANTS[ch];
      if (next === '्') { result += c; i++; }
      else if (DEVANAGARI_MATRAS[next] !== undefined) { result += c + DEVANAGARI_MATRAS[next]; i++; }
      else { result += c + 'a'; }
      continue;
    }
    if (DEVANAGARI_VOWELS[ch]) { result += DEVANAGARI_VOWELS[ch]; continue; }
    if (DEVANAGARI_MATRAS[ch] !== undefined) { result += DEVANAGARI_MATRAS[ch]; continue; }
    if (DEVANAGARI_DIGITS[ch]) { result += DEVANAGARI_DIGITS[ch]; continue; }
    if (ch.charCodeAt(0) < 128) { result += ch; }
  }
  return result || text;
}

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
  sellerLocation: string;
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
  allProductStats: ProductSalesStats[];
  catalogItems: CatalogItem[];
  recentOrders: Order[];
  dateRangeAnalytics: DateRangeAnalytics | null;
  recommendations: string[];
  generatedAt: string;
}

export async function generateReport(request: ReportRequest): Promise<ReportResult> {
  const { phone, reportType, language, customStartDate, customEndDate } = request;

  try {
    console.log(`Generating ${reportType} report for ${phone}`);

    const seller = await getSellerByPhone(phone);
    const sellerId = seller ? seller.PK.replace('SELLER#', '') : phone;
    const sellerName = seller?.name || 'Seller';
    const sellerLocation = seller?.location?.district
      ? `${seller.location.district}, ${seller.location.state || ''}`
      : seller?.location?.state || '';

    const { startDate, endDate, dateLabel, dateQuery } = getDateRange(reportType, customStartDate, customEndDate);

    const [topProducts, allProductStats, salesSummary, dateRangeData, catalogItems, allOrders] = await Promise.all([
      getTopSellingProducts(sellerId, 10, undefined, phone, true).catch(() => [] as ProductSalesStats[]),
      getTopSellingProducts(sellerId, 10, undefined, phone, false).catch(() => [] as ProductSalesStats[]),
      getSalesSummary(sellerId, undefined, phone).catch(() => ({
        totalOrders: 0, confirmedOrders: 0, pendingOrders: 0, rejectedOrders: 0, cancelledOrders: 0,
        totalRevenue: 0, confirmedRevenue: 0, pendingRevenue: 0,
        averageOrderValue: 0, topProduct: null, topProducts: [], timeRange: '30d',
      })),
      getDateRangeAnalytics(sellerId, dateQuery, phone).catch(() => null),
      getCatalogItemsBySeller(sellerId, phone).catch(() => [] as CatalogItem[]),
      getOrdersBySeller(sellerId, phone).catch(() => [] as Order[]),
    ]);

    const recentOrders = allOrders
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 15);

    const reportData: ReportData = {
      sellerName,
      sellerPhone: phone,
      sellerLocation,
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
      averageOrderValue: salesSummary.averageOrderValue > 0
        ? salesSummary.averageOrderValue
        : (salesSummary.totalOrders > 0 ? salesSummary.totalRevenue / salesSummary.totalOrders : 0),
      topProducts,
      allProductStats,
      catalogItems,
      recentOrders,
      dateRangeAnalytics: dateRangeData,
      recommendations: [],
      generatedAt: new Date().toISOString(),
    };

    reportData.recommendations = await generateRecommendations(reportData);

    const pdfBuffer = await buildPdf(reportData);

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

    console.log(`Report generated: ${s3Key}`);

    return {
      success: true,
      pdfUrl,
      s3Key,
      voiceSummary,
    };
  } catch (error) {
    console.error('Report generation failed:', error);
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
      dateLabel: `${startDate} to ${endDate}`,
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

async function buildPdf(data: ReportData): Promise<Buffer> {
  const content: any[] = [];

  const HDR = '#4A90D9';
  const HDR_TEXT = '#FFFFFF';
  const CURRENCY = 'Rs ';

  function sectionHeading(text: string): any {
    return { text, fontSize: 15, bold: true, color: '#2C3E50', margin: [0, 10, 0, 8] };
  }

  function dividerLine(): any {
    return {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#DDDDDD' }],
      margin: [0, 8, 0, 8],
    };
  }

  function statusColor(status: string): string {
    const map: Record<string, string> = {
      DELIVERED: '#27AE60', ACCEPTED: '#27AE60', PACKED: '#27AE60', SHIPPED: '#2980B9',
      PENDING: '#F39C12', REJECTED: '#E74C3C', CANCELLED: '#95A5A6',
    };
    return map[status] || '#2C3E50';
  }

  function statusLabel(status: string): string {
    const map: Record<string, string> = {
      DELIVERED: 'Delivered', ACCEPTED: 'Accepted', PACKED: 'Packed', SHIPPED: 'Shipped',
      PENDING: 'Pending', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
    };
    return map[status] || status;
  }

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  content.push({
    text: 'Vyapar Vaani - Business Report',
    fontSize: 22, bold: true, color: '#2C3E50', alignment: 'center', margin: [0, 0, 0, 5],
  });
  content.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: HDR }],
    margin: [0, 0, 0, 12],
  });

  const safeName = toLatinSafe(data.sellerName);
  const safeLocation = toLatinSafe(data.sellerLocation);

  const infoRows: any[][] = [
    [
      { text: 'Seller', bold: true, border: [false, false, false, false] },
      { text: safeName.toUpperCase(), border: [false, false, false, false] },
      { text: 'Phone', bold: true, border: [false, false, false, false] },
      { text: data.sellerPhone, border: [false, false, false, false] },
    ],
    [
      { text: 'Period', bold: true, border: [false, false, false, false] },
      { text: data.dateLabel, border: [false, false, false, false] },
      { text: 'Generated', bold: true, border: [false, false, false, false] },
      {
        text: new Date(data.generatedAt).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }),
        border: [false, false, false, false],
      },
    ],
  ];
  if (safeLocation) {
    infoRows.push([
      { text: 'Location', bold: true, border: [false, false, false, false] },
      { text: safeLocation, colSpan: 3, border: [false, false, false, false] }, {}, {},
    ]);
  }
  content.push({
    table: { widths: [60, '*', 60, '*'], body: infoRows },
    layout: 'noBorders',
    margin: [0, 0, 0, 15],
  });

  content.push(sectionHeading('Order Summary'));
  content.push({
    table: {
      widths: ['*', '*', '*', '*', '*'],
      body: [
        [
          { text: 'Total Orders', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
          { text: 'Confirmed', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
          { text: 'Pending', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
          { text: 'Rejected', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
          { text: 'Cancelled', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
        ],
        [
          { text: `${data.totalOrders}`, fontSize: 20, bold: true, color: '#2C3E50', alignment: 'center', border: [false, false, false, false] },
          { text: `${data.confirmedOrders}`, fontSize: 20, bold: true, color: '#27AE60', alignment: 'center', border: [false, false, false, false] },
          { text: `${data.pendingOrders}`, fontSize: 20, bold: true, color: '#F39C12', alignment: 'center', border: [false, false, false, false] },
          { text: `${data.rejectedOrders}`, fontSize: 20, bold: true, color: '#E74C3C', alignment: 'center', border: [false, false, false, false] },
          { text: `${data.cancelledOrders}`, fontSize: 20, bold: true, color: '#95A5A6', alignment: 'center', border: [false, false, false, false] },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 8],
  });

  content.push(sectionHeading('Revenue Breakdown'));
  content.push({
    table: {
      widths: ['*', '*', '*'],
      body: [
        [
          { text: 'Confirmed Revenue', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
          { text: 'Pending Revenue', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
          { text: 'Avg. Order Value', fontSize: 9, color: '#7F8C8D', alignment: 'center', border: [false, false, false, false] },
        ],
        [
          { text: `${CURRENCY}${data.confirmedRevenue.toFixed(0)}`, fontSize: 22, bold: true, color: '#27AE60', alignment: 'center', border: [false, false, false, false] },
          { text: `${CURRENCY}${data.pendingRevenue.toFixed(0)}`, fontSize: 22, bold: true, color: '#F39C12', alignment: 'center', border: [false, false, false, false] },
          { text: `${CURRENCY}${data.averageOrderValue.toFixed(0)}`, fontSize: 22, bold: true, color: '#2980B9', alignment: 'center', border: [false, false, false, false] },
        ],
      ],
    },
    layout: 'noBorders',
    margin: [0, 0, 0, 5],
  });

  const totalRev = data.confirmedRevenue + data.pendingRevenue;
  if (totalRev > 0) {
    const confPct = data.confirmedRevenue > 0 ? Math.round((data.confirmedRevenue / totalRev) * 100) : 0;
    content.push({
      text: `Total Potential Revenue: ${CURRENCY}${totalRev.toFixed(0)}  (${confPct}% confirmed, ${100 - confPct}% pending)`,
      fontSize: 10, color: '#34495E', italics: true, alignment: 'center', margin: [0, 0, 0, 10],
    });
  }

  content.push(dividerLine());

  const productsToShow = data.allProductStats.length > 0 ? data.allProductStats : data.topProducts;
  content.push(sectionHeading('Product Performance (All Orders)'));

  const prodRows: any[][] = [[
    { text: '#', bold: true, fillColor: HDR, color: HDR_TEXT, alignment: 'center' as const },
    { text: 'Product', bold: true, fillColor: HDR, color: HDR_TEXT },
    { text: 'Orders', bold: true, fillColor: HDR, color: HDR_TEXT, alignment: 'center' as const },
    { text: 'Qty Sold', bold: true, fillColor: HDR, color: HDR_TEXT, alignment: 'center' as const },
    { text: 'Revenue', bold: true, fillColor: HDR, color: HDR_TEXT, alignment: 'right' as const },
    { text: 'Avg Price', bold: true, fillColor: HDR, color: HDR_TEXT, alignment: 'right' as const },
  ]];

  if (productsToShow.length > 0) {
    productsToShow.forEach((p, i) => {
      const avgPrice = p.totalQuantity > 0 ? p.totalRevenue / p.totalQuantity : 0;
      prodRows.push([
        { text: `${i + 1}`, alignment: 'center' },
        toLatinSafe(p.productName) || 'Unknown',
        { text: `${p.totalOrders}`, alignment: 'center' },
        { text: `${p.totalQuantity}`, alignment: 'center' },
        { text: `${CURRENCY}${p.totalRevenue.toFixed(0)}`, alignment: 'right' },
        { text: `${CURRENCY}${avgPrice.toFixed(0)}`, alignment: 'right' },
      ]);
    });
  } else {
    prodRows.push([{
      text: 'No products sold in this period.',
      colSpan: 6, alignment: 'center', italics: true, color: '#7F8C8D',
    }, {}, {}, {}, {}, {}]);
  }

  content.push({
    table: { headerRows: 1, widths: [25, '*', 45, 50, 65, 60], body: prodRows },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => '#DDDDDD', vLineColor: () => '#DDDDDD',
      paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5,
    },
    margin: [0, 0, 0, 10],
  });

  content.push(dividerLine());

  const activeCatalog = data.catalogItems.filter(c => c.status === 'ACTIVE' || c.status === 'DRAFT');
  content.push(sectionHeading(`Your Product Catalog (${activeCatalog.length} items)`));

  if (activeCatalog.length > 0) {
    const catRows: any[][] = [[
      { text: '#', bold: true, fillColor: '#2ECC71', color: HDR_TEXT, alignment: 'center' as const },
      { text: 'Product Name', bold: true, fillColor: '#2ECC71', color: HDR_TEXT },
      { text: 'Price', bold: true, fillColor: '#2ECC71', color: HDR_TEXT, alignment: 'right' as const },
      { text: 'Stock', bold: true, fillColor: '#2ECC71', color: HDR_TEXT, alignment: 'center' as const },
      { text: 'Status', bold: true, fillColor: '#2ECC71', color: HDR_TEXT, alignment: 'center' as const },
    ]];

    activeCatalog.slice(0, 20).forEach((item, i) => {
      const name = toLatinSafe(item.becknItem?.descriptor?.name || item.itemId);
      const price = item.becknItem?.price?.value ? `${CURRENCY}${item.becknItem.price.value}` : 'N/A';
      const stock = item.becknItem?.quantity?.available?.count ?? 'N/A';
      const st = item.status === 'ACTIVE' ? 'Active' : 'Draft';
      const sClr = item.status === 'ACTIVE' ? '#27AE60' : '#F39C12';
      catRows.push([
        { text: `${i + 1}`, alignment: 'center' },
        name,
        { text: price, alignment: 'right' },
        { text: `${stock}`, alignment: 'center' },
        { text: st, alignment: 'center', color: sClr, bold: true },
      ]);
    });

    content.push({
      table: { headerRows: 1, widths: [25, '*', 65, 50, 55], body: catRows },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => '#DDDDDD', vLineColor: () => '#DDDDDD',
        paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5,
      },
      margin: [0, 0, 0, 10],
    });
  } else {
    content.push({
      text: 'No products listed in your catalog yet. Add products via WhatsApp to start selling.',
      fontSize: 10, color: '#7F8C8D', italics: true, margin: [10, 0, 0, 10],
    });
  }

  content.push(dividerLine());

  content.push(sectionHeading(`Recent Orders (${data.recentOrders.length})`));

  if (data.recentOrders.length > 0) {
    const orderRows: any[][] = [[
      { text: '#', bold: true, fillColor: '#8E44AD', color: HDR_TEXT, alignment: 'center' as const },
      { text: 'Order ID', bold: true, fillColor: '#8E44AD', color: HDR_TEXT },
      { text: 'Date', bold: true, fillColor: '#8E44AD', color: HDR_TEXT },
      { text: 'Items', bold: true, fillColor: '#8E44AD', color: HDR_TEXT, alignment: 'center' as const },
      { text: 'Amount', bold: true, fillColor: '#8E44AD', color: HDR_TEXT, alignment: 'right' as const },
      { text: 'Status', bold: true, fillColor: '#8E44AD', color: HDR_TEXT, alignment: 'center' as const },
    ]];

    data.recentOrders.slice(0, 10).forEach((order, i) => {
      const itemCount = order.items.reduce((s, it) => s + it.quantity, 0);
      const amount = order.items.reduce((s, it) => s + it.price * it.quantity, 0);
      const shortId = order.orderId.length > 12 ? '...' + order.orderId.slice(-8) : order.orderId;
      orderRows.push([
        { text: `${i + 1}`, alignment: 'center' },
        { text: shortId, fontSize: 9 },
        { text: fmtDate(order.createdAt), fontSize: 9 },
        { text: `${itemCount}`, alignment: 'center' },
        { text: `${CURRENCY}${amount.toFixed(0)}`, alignment: 'right' },
        { text: statusLabel(order.status), alignment: 'center', color: statusColor(order.status), bold: true, fontSize: 9 },
      ]);
    });

    content.push({
      table: { headerRows: 1, widths: [25, '*', 65, 40, 60, 55], body: orderRows },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => '#DDDDDD', vLineColor: () => '#DDDDDD',
        paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4,
      },
      margin: [0, 0, 0, 10],
    });

    if (data.recentOrders.length > 10) {
      content.push({
        text: `... and ${data.recentOrders.length - 10} more orders not shown`,
        fontSize: 9, color: '#7F8C8D', italics: true, alignment: 'center', margin: [0, 0, 0, 5],
      });
    }
  } else {
    content.push({
      text: 'No orders received in this period. Share your marketplace link to start receiving orders.',
      fontSize: 10, color: '#7F8C8D', italics: true, margin: [10, 0, 0, 10],
    });
  }

  content.push(dividerLine());

  content.push(sectionHeading('AI-Powered Recommendations'));

  if (data.recommendations.length > 0) {
    data.recommendations.forEach((r, i) => {
      const cleaned = r.replace(/^\d+[\.\)\-]\s*/, '').trim();
      content.push({
        columns: [
          { text: `${i + 1}.`, width: 18, bold: true, color: HDR, fontSize: 11 },
          { text: cleaned, width: '*', fontSize: 11, color: '#34495E', lineHeight: 1.4 },
        ],
        margin: [5, 0, 0, 6],
      });
    });
  } else {
    content.push({
      text: 'Add more products and get orders to receive personalized AI recommendations.',
      fontSize: 10, color: '#7F8C8D', italics: true, margin: [10, 0, 0, 6],
    });
  }

  content.push({
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#DDDDDD' }],
    margin: [0, 20, 0, 10],
  });
  content.push({
    text: 'Powered by Vyapar Vaani -- AI Business Assistant for Rural India',
    fontSize: 9, color: '#95A5A6', alignment: 'center', italics: true,
  });

  const docDefinition: any = {
    pageSize: 'A4',
    pageMargins: [40, 50, 40, 50],
    content,
    defaultStyle: { fontSize: 11, lineHeight: 1.3 },
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

async function generateRecommendations(data: ReportData): Promise<string[]> {
  try {
    const productList = data.allProductStats.length > 0
      ? data.allProductStats.map(p =>
          `${toLatinSafe(p.productName)}: ${p.totalOrders} orders, ${p.totalQuantity} units sold, Rs ${p.totalRevenue.toFixed(0)} revenue, avg Rs ${p.averageOrderValue.toFixed(0)}/order`
        ).join('\n')
      : 'No products sold yet';

    const catalogList = data.catalogItems
      .filter(c => c.status === 'ACTIVE' || c.status === 'DRAFT')
      .map(c => {
        const name = toLatinSafe(c.becknItem?.descriptor?.name || c.itemId);
        const price = c.becknItem?.price?.value || 'unknown';
        const stock = c.becknItem?.quantity?.available?.count ?? 'unknown';
        return `${name}: listed at Rs ${price}, stock ${stock}`;
      })
      .join('\n') || 'No products in catalog';

    const orderSummary = data.recentOrders.length > 0
      ? data.recentOrders.slice(0, 5).map(o => {
          const amt = o.items.reduce((s, it) => s + it.price * it.quantity, 0);
          return `Order ${o.orderId.slice(-6)}: Rs ${amt.toFixed(0)}, status ${o.status}, ${new Date(o.createdAt).toLocaleDateString('en-IN')}`;
        }).join('\n')
      : 'No recent orders';

    const prompt = `You are a business advisor for rural Indian sellers on the ONDC marketplace. Based on this seller's REAL data, give exactly 4 specific, actionable recommendations in ENGLISH.

Seller: ${data.sellerName}
Location: ${data.sellerLocation || 'India'}
Report Period: ${data.dateLabel}

ORDER DATA:
Total Orders: ${data.totalOrders}
Confirmed Orders: ${data.confirmedOrders} (revenue: Rs ${data.confirmedRevenue.toFixed(0)})
Pending Orders: ${data.pendingOrders} (revenue: Rs ${data.pendingRevenue.toFixed(0)})
Rejected Orders: ${data.rejectedOrders}
Cancelled Orders: ${data.cancelledOrders}
Average Order Value: Rs ${data.averageOrderValue.toFixed(0)}

PRODUCT SALES:
${productList}

CATALOG ITEMS (currently listed):
${catalogList}

RECENT ORDERS:
${orderSummary}

RULES:
- Write in ENGLISH only. No Hindi, no Devanagari, no special characters.
- Each recommendation must be 1-2 sentences, specific and actionable.
- Reference ACTUAL numbers from the data above (products, revenue, order counts).
- Focus on: (a) improving conversion of pending orders to confirmed, (b) pricing optimization, (c) catalog expansion based on what sells, (d) stock and fulfillment improvements.
- If the seller has few or no sales, focus on catalog building, pricing strategy, and promotion tips.
- If there are rejected/cancelled orders, address why and how to reduce them.
- Be concrete: mention specific product names, amounts, and percentages.
- Return EXACTLY 4 lines, one recommendation per line. No numbering, no bullets.`;

    const command = new InvokeModelCommand({
      modelId: NOVA_LITE_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { max_new_tokens: 500, temperature: 0.7 },
      }),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const text = responseBody.output.message.content[0].text.trim();

    const lines = text.split('\n').filter((l: string) => l.trim().length > 0).slice(0, 4);
    return lines.length > 0 ? lines : getDefaultRecommendations();
  } catch (error) {
    console.warn('AI recommendations failed, using defaults:', error);
    return getDefaultRecommendations();
  }
}

function getDefaultRecommendations(): string[] {
  return [
    'Keep your top-selling products well stocked to avoid missing orders when demand is high.',
    'Review your pricing regularly against current mandi rates to stay competitive and attract more buyers.',
    'Add seasonal products to your catalog to give customers more variety and increase average order value.',
    'Share your ONDC marketplace link on WhatsApp groups and with local contacts to reach more customers.',
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

    parts.push(`Kul ${data.totalOrders} orders aaye.`);

    if (data.confirmedOrders > 0) {
      parts.push(`Confirmed orders: ${data.confirmedOrders}, revenue ${data.confirmedRevenue} rupaye.`);
    }
    if (data.pendingOrders > 0) {
      parts.push(`Pending orders: ${data.pendingOrders}, ${data.pendingRevenue} rupaye pending hain.`);
    }
    if (data.totalOrders === 0) {
      parts.push('Is samay mein abhi koi order nahi aaya.');
    }

    if (data.allProductStats.length > 0) {
      parts.push(`Sabse zyada bikne wala product ${toLatinSafe(data.allProductStats[0].productName)} raha.`);
    }

    const activeCount = data.catalogItems.filter(c => c.status === 'ACTIVE').length;
    parts.push(`Aapke catalog mein ${activeCount} products listed hain.`);

    parts.push('PDF report bhej raha hoon, ismein poori detail aur AI suggestions hain.');

    return parts.join(' ');
  }

  const parts: string[] = [];
  parts.push(`${data.sellerName}, your ${data.reportType} report is ready.`);
  parts.push(`Total ${data.totalOrders} orders received.`);

  if (data.confirmedOrders > 0) {
    parts.push(`Confirmed: ${data.confirmedOrders} orders, ${data.confirmedRevenue} rupees revenue.`);
  }
  if (data.pendingOrders > 0) {
    parts.push(`Pending: ${data.pendingOrders} orders worth ${data.pendingRevenue} rupees.`);
  }
  if (data.totalOrders === 0) {
    parts.push('No orders recorded for this period yet.');
  }

  if (data.allProductStats.length > 0) {
    parts.push(`Top product: ${toLatinSafe(data.allProductStats[0].productName)}.`);
  }

  const activeCount = data.catalogItems.filter(c => c.status === 'ACTIVE').length;
  parts.push(`You have ${activeCount} products in your catalog.`);
  parts.push('Sending the detailed PDF report with AI-powered recommendations.');

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
