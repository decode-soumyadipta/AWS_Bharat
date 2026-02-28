#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { VyaparVaaniStack } from './stacks/vyapar-vaani-stack';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const app = new cdk.App();

new VyaparVaaniStack(app, 'VyaparVaaniStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-south-1', // Mumbai region for India
  },
  description: 'Vyapar-Vaani: Headless ONDC Seller Node for rural merchants',
});

app.synth();
