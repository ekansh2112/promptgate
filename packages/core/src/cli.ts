#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import chalk from 'chalk';
import ora from 'ora';
import { GeminiProvider } from './providers/gemini.js';
import { DEFAULT_TARGET_MODEL } from './models.js';

const program = new Command();

program
  .name('promptgate')
  .description('PromptGate CLI - CI eval gate for LLM prompts')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize a prompt with test cases and rubric')
  .argument('<prompt-file>', 'Path to the prompt file')
  .option('-o, --output <dir>', 'Output directory', '.')
  .option('-m, --model <model>', 'Model to use', DEFAULT_TARGET_MODEL)
  .action(async (promptFile, options) => {
    const spinner = ora('Generating test cases and rubric...').start();

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        spinner.fail('GEMINI_API_KEY environment variable not set');
        process.exit(1);
      }

      const provider = new GeminiProvider({ apiKey });
      const promptContent = await fs.readFile(promptFile, 'utf-8');

      const variables = extractVariables(promptContent);

      const testCasePrompt = `You are helping generate test cases for an LLM prompt evaluation system.

PROMPT TO TEST:
${promptContent}

VARIABLES: ${variables.join(', ') || 'none'}

Generate 5 diverse test cases that cover different scenarios. Each test case should have:
- A descriptive name
- Input values for the variables
- Whether it's critical (true for important edge cases)

Respond in JSON format:
{
  "testCases": [
    {
      "name": "string",
      "inputs": { "variable": "value" },
      "critical": boolean
    }
  ]
}`;

      const testCaseResponse = await provider.call({
        model: options.model,
        prompt: testCasePrompt,
        temperature: 0.7,
      });

      const rubricPrompt = `You are helping generate an evaluation rubric for an LLM prompt.

PROMPT:
${promptContent}

Write a clear, concise rubric (2-4 sentences) that explains what makes a good output for this prompt. Focus on:
- Correctness criteria
- Required elements
- Quality standards

Respond with just the rubric text, no JSON or formatting.`;

      const rubricResponse = await provider.call({
        model: options.model,
        prompt: rubricPrompt,
        temperature: 0.5,
      });

      const testCasesData = JSON.parse(testCaseResponse.content);
      const testCases = testCasesData.testCases || [];

      const testSetPath = path.join(
        options.output,
        `${path.basename(promptFile, path.extname(promptFile))}.testset.yaml`
      );
      await fs.writeFile(testSetPath, YAML.stringify(testCases), 'utf-8');

      const rubricPath = path.join(
        options.output,
        `${path.basename(promptFile, path.extname(promptFile))}.rubric.txt`
      );
      await fs.writeFile(rubricPath, rubricResponse.content.trim(), 'utf-8');

      spinner.succeed('Generated test cases and rubric');
      console.log(chalk.green(`\nTest cases: ${testSetPath}`));
      console.log(chalk.green(`Rubric: ${rubricPath}`));
      console.log(
        chalk.yellow(
          '\nPlease review and edit these files before using them in production.'
        )
      );
    } catch (error: any) {
      spinner.fail(`Failed: ${error.message}`);
      process.exit(1);
    }
  });

function extractVariables(prompt: string): string[] {
  const matches = prompt.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

program.parse();
