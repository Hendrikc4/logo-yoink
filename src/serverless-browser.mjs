import serverlessChromium from '@sparticuz/chromium';

/**
 * Resolve Chromium only when a rendered fallback is actually needed. Keeping
 * this lazy avoids paying the Brotli extraction cost on ordinary static hits.
 */
export async function serverlessBrowserLaunchOptions(environment = process.env, chromium = serverlessChromium) {
  if (!environment.VERCEL && !environment.AWS_LAMBDA_FUNCTION_NAME) return undefined;
  chromium.setGraphicsMode = false;
  return {
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  };
}
