/**
 * Image Quality Checker
 * 
 * Analyzes product images for quality issues and provides
 * actionable feedback to sellers in their language.
 * 
 * Features:
 * - Technical quality analysis (Rekognition)
 * - AI-powered contextual feedback
 * - Multilingual suggestions
 * - Inappropriate content detection
 */

import { RekognitionClient, DetectLabelsCommand, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import { InvokeModelCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const rekognitionClient = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });
const bedrockClient = new BedrockRuntimeClient({ region: 'us-east-1' });
const NOVA_MODEL_ID = 'us.amazon.nova-lite-v1:0';

/**
 * Image quality report
 */
export interface QualityReport {
  isGoodQuality: boolean;
  score: number; // 0-100
  issues: string[];
  suggestions: string[];
  feedback: string; // In seller's language
  confidence: number;
}

/**
 * Check image quality and provide feedback
 */
export async function checkImageQuality(
  bucket: string,
  key: string,
  language: string
): Promise<QualityReport> {
  console.log('Checking image quality for:', key);

  try {
    // 1. Technical analysis with Rekognition
    const technicalAnalysis = await analyzeImageTechnically(bucket, key);

    // 2. Generate AI feedback
    const feedback = await generateQualityFeedback(
      technicalAnalysis,
      language
    );

    const report: QualityReport = {
      isGoodQuality: technicalAnalysis.score >= 70,
      score: technicalAnalysis.score,
      issues: technicalAnalysis.issues,
      suggestions: feedback.suggestions,
      feedback: feedback.message,
      confidence: 0.85
    };

    console.log('Quality report:', report);
    return report;

  } catch (error) {
    console.error('Image quality check failed:', error);
    
    // Fallback - assume image is acceptable
    return generateFallbackReport(language);
  }
}

/**
 * Analyze image technically using Rekognition
 */
async function analyzeImageTechnically(bucket: string, key: string) {
  const issues: string[] = [];
  let score = 100;

  try {
    // Detect labels for content analysis
    const detectLabelsCommand = new DetectLabelsCommand({
      Image: {
        S3Object: { 
          Bucket: bucket, 
          Name: key 
        }
      },
      MaxLabels: 20,
      MinConfidence: 70
    });

    const labelsResult = await rekognitionClient.send(detectLabelsCommand);
    const labels = labelsResult.Labels || [];

    // Check if image has recognizable objects
    if (labels.length < 3) {
      issues.push('low_detail');
      score -= 20;
    }

    // Check label confidence (proxy for image quality)
    const avgConfidence = labels.reduce((sum, l) => sum + (l.Confidence || 0), 0) / labels.length;
    if (avgConfidence < 80) {
      issues.push('low_clarity');
      score -= 15;
    }

    // Detect inappropriate content
    const moderationCommand = new DetectModerationLabelsCommand({
      Image: {
        S3Object: { 
          Bucket: bucket, 
          Name: key 
        }
      },
      MinConfidence: 60
    });

    const moderationResult = await rekognitionClient.send(moderationCommand);
    const moderationLabels = moderationResult.ModerationLabels || [];

    if (moderationLabels.length > 0) {
      issues.push('inappropriate_content');
      score -= 50;
    }

    // Check for common quality indicators
    const hasGoodLighting = labels.some(l => 
      l.Name?.toLowerCase().includes('bright') || 
      l.Name?.toLowerCase().includes('light')
    );

    if (!hasGoodLighting) {
      issues.push('poor_lighting');
      score -= 10;
    }

    return {
      score: Math.max(0, score),
      issues,
      labels: labels.map(l => l.Name || ''),
      avgConfidence
    };

  } catch (error) {
    console.error('Rekognition analysis failed:', error);
    
    // Return neutral analysis
    return {
      score: 70,
      issues: [],
      labels: [],
      avgConfidence: 75
    };
  }
}

/**
 * Generate AI-powered quality feedback
 */
async function generateQualityFeedback(
  technicalAnalysis: any,
  language: string
): Promise<{ message: string; suggestions: string[] }> {
  const prompt = buildQualityFeedbackPrompt(technicalAnalysis, language);

  try {
    const aiResponse = await invokeNovaLite(prompt);
    return parseQualityFeedback(aiResponse);
  } catch (error) {
    console.error('AI feedback generation failed:', error);
    return generateFallbackFeedback(technicalAnalysis, language);
  }
}

/**
 * Build AI prompt for quality feedback
 */
function buildQualityFeedbackPrompt(
  analysis: any,
  language: string
): string {
  const languageMap: Record<string, string> = {
    'hi-IN': 'Hindi',
    'mr-IN': 'Marathi',
    'en-IN': 'English'
  };

  const lang = languageMap[language] || 'Hindi';

  const issueDescriptions: Record<string, string> = {
    'low_detail': 'Image has few recognizable objects',
    'low_clarity': 'Image appears blurry or unclear',
    'inappropriate_content': 'Image contains inappropriate content',
    'poor_lighting': 'Image has poor lighting'
  };

  const issuesText = analysis.issues.length > 0
    ? analysis.issues.map((i: string) => `- ${issueDescriptions[i] || i}`).join('\n')
    : 'No major issues detected';

  return `You are helping a rural Indian seller improve their product photo quality.

Technical Analysis:
- Quality Score: ${analysis.score}/100
- Issues Found:
${issuesText}
- Objects Detected: ${analysis.labels.slice(0, 5).join(', ')}

Provide encouraging, actionable feedback in ${lang}:
1. What's the overall quality? (good/needs improvement)
2. If issues exist, explain them simply
3. Provide 2-3 specific, actionable suggestions
4. Keep it positive and encouraging
5. Use simple language a rural seller can understand

Format:
{
  "message": "Main feedback message in ${lang} (2-3 sentences)",
  "suggestions": [
    "Specific suggestion 1 in ${lang}",
    "Specific suggestion 2 in ${lang}",
    "Specific suggestion 3 in ${lang}"
  ]
}

Important:
- Be encouraging, not critical
- Give practical advice they can implement
- Focus on what they can improve
- Keep language simple and friendly

Generate feedback now:`;
}

/**
 * Invoke Nova Lite for feedback generation
 */
async function invokeNovaLite(prompt: string): Promise<string> {
  const requestBody = {
    messages: [
      {
        role: 'user',
        content: [{ text: prompt }]
      }
    ],
    inferenceConfig: {
      max_new_tokens: 400,
      temperature: 0.7,
      top_p: 0.9
    }
  };

  const command = new InvokeModelCommand({
    modelId: NOVA_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody)
  });

  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response from Nova Lite');
  }

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const text = responseBody.output?.message?.content?.[0]?.text;

  if (!text) {
    throw new Error('No text in Nova Lite response');
  }

  return text;
}

/**
 * Parse AI feedback response
 */
function parseQualityFeedback(response: string): { message: string; suggestions: string[] } {
  try {
    let jsonText = response.trim();
    
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const parsed = JSON.parse(jsonText);

    return {
      message: parsed.message || '',
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : []
    };

  } catch (error) {
    console.error('Failed to parse quality feedback:', error);
    throw error;
  }
}

/**
 * Generate fallback feedback based on technical analysis
 */
function generateFallbackFeedback(
  analysis: any,
  language: string
): { message: string; suggestions: string[] } {
  const templates: Record<string, any> = {
    'hi-IN': {
      good: {
        message: 'आपकी फोटो अच्छी गुणवत्ता की है। यह उत्पाद को अच्छी तरह दिखाती है।',
        suggestions: [
          'फोटो को और बेहतर बनाने के लिए अच्छी रोशनी में लें',
          'उत्पाद को साफ़ पृष्ठभूमि पर रखें',
          'कैमरा स्थिर रखें और फोकस करें'
        ]
      },
      poor: {
        message: 'आपकी फोटो में सुधार की गुंजाइश है। बेहतर फोटो से ज्यादा खरीदार आकर्षित होंगे।',
        suggestions: [
          'अच्छी रोशनी में फोटो लें (दिन के समय बाहर की रोशनी सबसे अच्छी है)',
          'उत्पाद को साफ़, सादे पृष्ठभूमि पर रखें',
          'कैमरा स्थिर रखें और उत्पाद पर फोकस करें'
        ]
      }
    },
    'mr-IN': {
      good: {
        message: 'तुमचा फोटो चांगल्या गुणवत्तेचा आहे. हे उत्पादन चांगले दाखवते.',
        suggestions: [
          'फोटो आणखी चांगला करण्यासाठी चांगल्या प्रकाशात घ्या',
          'उत्पादन स्वच्छ पार्श्वभूमीवर ठेवा',
          'कॅमेरा स्थिर ठेवा आणि फोकस करा'
        ]
      },
      poor: {
        message: 'तुमच्या फोटोमध्ये सुधारणा करता येईल. चांगला फोटो अधिक खरेदीदार आकर्षित करेल.',
        suggestions: [
          'चांगल्या प्रकाशात फोटो घ्या (दिवसा बाहेरचा प्रकाश सर्वोत्तम आहे)',
          'उत्पादन स्वच्छ, साध्या पार्श्वभूमीवर ठेवा',
          'कॅमेरा स्थिर ठेवा आणि उत्पादनावर फोकस करा'
        ]
      }
    },
    'en-IN': {
      good: {
        message: 'Your photo is of good quality. It shows the product well.',
        suggestions: [
          'Take photo in good lighting to make it even better',
          'Place product on clean background',
          'Keep camera steady and focus on product'
        ]
      },
      poor: {
        message: 'Your photo can be improved. Better photos attract more buyers.',
        suggestions: [
          'Take photo in good lighting (daylight outdoors is best)',
          'Place product on clean, plain background',
          'Keep camera steady and focus on product'
        ]
      }
    }
  };

  const template = templates[language] || templates['hi-IN'];
  const quality = analysis.score >= 70 ? 'good' : 'poor';

  return template[quality];
}

/**
 * Generate fallback report when analysis fails
 */
function generateFallbackReport(language: string): QualityReport {
  const templates: Record<string, string> = {
    'hi-IN': 'आपकी फोटो प्राप्त हो गई है। हम इसे प्रोसेस कर रहे हैं।',
    'mr-IN': 'तुमचा फोटो मिळाला आहे. आम्ही त्यावर प्रक्रिया करत आहोत.',
    'en-IN': 'Your photo has been received. We are processing it.'
  };

  return {
    isGoodQuality: true,
    score: 70,
    issues: [],
    suggestions: [],
    feedback: templates[language] || templates['hi-IN'],
    confidence: 0.3
  };
}
