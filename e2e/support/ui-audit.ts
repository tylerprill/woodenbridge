import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
  type TestInfo,
} from '@playwright/test';

type BrowserIssue =
  | {
      kind: 'console';
      level: 'error' | 'warning';
      message: string;
      url?: string;
    }
  | { kind: 'page-error'; message: string }
  | { kind: 'request-failed'; message: string; url: string }
  | {
      kind: 'http-response';
      resourceType: string;
      status: number;
      url: string;
    };

type BrowserIssueMonitor = {
  flush: () => BrowserIssue[];
  stop: () => void;
};

type AuditOptions = {
  accessibility?: boolean;
  expectedHeading?: string | RegExp;
  expectedPath?: string | RegExp;
  expectedSelector?: string;
  expectedStatus?: number;
  screenshot?: boolean;
};

function safeName(value: string) {
  return value
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function monitorBrowserIssues(page: Page): BrowserIssueMonitor {
  let issues: BrowserIssue[] = [];
  const origin = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100');

  const onConsole = (message: ConsoleMessage) => {
    const messageText = message.text();
    const level = message.type();
    const isHeadlessGpuDiagnostic =
      level === 'warning' &&
      messageText.includes('GL Driver Message') &&
      messageText.includes('GPU stall due to ReadPixels');
    if (isHeadlessGpuDiagnostic) return;

    if (level === 'error' || level === 'warning') {
      const location = message.location();
      issues.push({
        kind: 'console',
        level,
        message: messageText,
        url: location.url || undefined,
      });
    }
  };
  const onPageError = (error: Error) => {
    issues.push({ kind: 'page-error', message: error.message });
  };
  const onRequestFailed = (request: Request) => {
    const failure = request.failure();
    const requestUrl = new URL(request.url());
    const expectedNavigationCancellation =
      request.isNavigationRequest() &&
      Boolean(
        failure &&
        /ERR_ABORTED|NS_BINDING_ABORTED|cancel(?:led|ed)/i.test(
          failure.errorText,
        ),
      );
    const expectedNextPrefetchCancellation =
      requestUrl.searchParams.has('_rsc') &&
      Boolean(
        failure &&
        /ERR_ABORTED|NS_BINDING_ABORTED|cancel(?:led|ed)/i.test(
          failure.errorText,
        ),
      );
    if (
      requestUrl.origin === origin.origin &&
      failure &&
      !expectedNavigationCancellation &&
      !expectedNextPrefetchCancellation
    ) {
      issues.push({
        kind: 'request-failed',
        message: failure.errorText,
        url: request.url(),
      });
    }
  };
  const onResponse = (response: Response) => {
    if (response.status() < 400) return;
    const responseUrl = new URL(response.url());
    if (responseUrl.origin !== origin.origin) return;

    issues.push({
      kind: 'http-response',
      resourceType: response.request().resourceType(),
      status: response.status(),
      url: response.url(),
    });
  };

  const issueKey = (issue: BrowserIssue) => {
    if (issue.kind === 'console') {
      return `${issue.kind}:${issue.level}:${issue.url ?? ''}:${issue.message}`;
    }
    if (issue.kind === 'http-response') {
      return `${issue.kind}:${issue.status}:${issue.resourceType}:${issue.url}`;
    }
    return `${issue.kind}:${'url' in issue ? issue.url : ''}:${issue.message}`;
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return {
    flush() {
      const captured = Array.from(
        new Map(issues.map((issue) => [issueKey(issue), issue])).values(),
      );
      issues = [];
      return captured;
    },
    stop() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
    },
  };
}

function sameDocumentUrl(candidate: string, pageUrl: string) {
  try {
    const candidateUrl = new URL(candidate);
    const documentUrl = new URL(pageUrl);
    return (
      candidateUrl.origin === documentUrl.origin &&
      candidateUrl.pathname === documentUrl.pathname &&
      candidateUrl.search === documentUrl.search
    );
  } catch {
    return false;
  }
}

function isExpectedDocumentFailure(
  issue: BrowserIssue,
  pageUrl: string,
  expectedStatus?: number,
) {
  if (!expectedStatus || expectedStatus < 400) return false;

  if (issue.kind === 'http-response') {
    return (
      issue.resourceType === 'document' &&
      issue.status === expectedStatus &&
      sameDocumentUrl(issue.url, pageUrl)
    );
  }

  return (
    issue.kind === 'console' &&
    issue.level === 'error' &&
    Boolean(issue.url) &&
    sameDocumentUrl(issue.url ?? '', pageUrl) &&
    new RegExp(
      `status (?:code )?of ${expectedStatus}|\\b${expectedStatus}\\b`,
      'i',
    ).test(issue.message)
  );
}

function describeBrowserIssue(issue: BrowserIssue) {
  if (issue.kind === 'console') {
    return `console ${issue.level}: ${issue.message}${issue.url ? ` (${issue.url})` : ''}`;
  }
  if (issue.kind === 'page-error') return `page error: ${issue.message}`;
  if (issue.kind === 'request-failed') {
    return `request failed: ${issue.url} (${issue.message})`;
  }
  return `HTTP ${issue.status}: ${issue.url} (${issue.resourceType})`;
}

export async function auditCurrentPage(
  page: Page,
  testInfo: TestInfo,
  label: string,
  monitor: BrowserIssueMonitor,
  options: AuditOptions = {},
) {
  await page.locator('body').waitFor({ state: 'visible' });
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.evaluate(async () => {
    const root = document.documentElement;
    const step = Math.max(320, Math.floor(window.innerHeight * 0.75));
    for (let top = 0; top < root.scrollHeight; top += step) {
      window.scrollTo(0, top);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    }
    window.scrollTo(0, 0);
  });
  await page
    .waitForFunction(
      () => Array.from(document.images).every((image) => image.complete),
      undefined,
      { timeout: 8_000 },
    )
    .catch(() => {});
  // WebKit reports programmatic style mutations against the current document's
  // CSP asynchronously, after the audit has moved to the next route. The scroll
  // pass above already paints content-visibility sections in Safari.
  if (!testInfo.project.name.includes('webkit')) {
    await page.evaluate(() => {
      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>('*'),
      )) {
        if (getComputedStyle(element).contentVisibility === 'auto') {
          element.style.setProperty(
            'content-visibility',
            'visible',
            'important',
          );
        }
      }
    });
  }

  const viewport = page.viewportSize();
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const interactiveSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[role="button"]:not([aria-disabled="true"])',
    ].join(',');

    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const describe = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const text =
        element.getAttribute('aria-label') ||
        htmlElement.innerText?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
        element.getAttribute('name') ||
        element.tagName.toLowerCase();
      return `${element.tagName.toLowerCase()} "${text}"`;
    };
    const insideHorizontalScroller = (element: Element) => {
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const style = getComputedStyle(parent);
        if (
          parent.scrollWidth > parent.clientWidth + 1 &&
          (style.overflowX === 'auto' || style.overflowX === 'scroll')
        ) {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };

    const interactive = Array.from(
      document.querySelectorAll<HTMLElement>(interactiveSelector),
    ).filter(visible);
    const effectiveRect = (element: HTMLElement) => {
      const usesLabelAsHitArea =
        element instanceof HTMLInputElement &&
        (element.type === 'checkbox' || element.type === 'radio');
      if (usesLabelAsHitArea && element.id) {
        const label = document.querySelector<HTMLLabelElement>(
          `label[for="${CSS.escape(element.id)}"]`,
        );
        if (label && visible(label)) return label.getBoundingClientRect();
      }
      if (usesLabelAsHitArea) {
        const wrappingLabel = element.closest('label');
        if (wrappingLabel && visible(wrappingLabel)) {
          return wrappingLabel.getBoundingClientRect();
        }
      }
      return element.getBoundingClientRect();
    };
    const clippedControls = interactive
      .filter((element) => {
        if (insideHorizontalScroller(element)) return false;
        const rect = effectiveRect(element);
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      })
      .map(describe);
    const smallTouchTargets = interactive
      .filter((element) => {
        const mapAttributionLink = element.matches('.maplibregl-ctrl-attrib a');
        const inlineTextLink =
          element.matches('a[href]:not([role="button"])') &&
          getComputedStyle(element).display === 'inline' &&
          Boolean(element.closest('p, li'));
        if (inlineTextLink || mapAttributionLink) {
          return false;
        }
        const rect = effectiveRect(element);
        return rect.width < 40 || rect.height < 40;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return `${describe(element)} (${Math.round(rect.width)}×${Math.round(rect.height)})`;
      });
    const smallEditableText = Array.from(
      document.querySelectorAll<HTMLElement>(
        'textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]):not([type="submit"]):not([type="button"])',
      ),
    )
      .filter(visible)
      .filter(
        (element) => Number.parseFloat(getComputedStyle(element).fontSize) < 16,
      )
      .map(
        (element) =>
          `${describe(element)} (${getComputedStyle(element).fontSize})`,
      );

    return {
      clippedControls,
      failedImages: Array.from(document.images)
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src),
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      mainLandmarks: document.querySelectorAll('main').length,
      smallEditableText,
      smallTouchTargets,
    };
  });

  expect
    .soft(metrics.horizontalOverflow, `${label}: horizontal overflow`)
    .toBeLessThanOrEqual(1);
  expect
    .soft(metrics.clippedControls, `${label}: clipped controls`)
    .toEqual([]);
  expect.soft(metrics.failedImages, `${label}: failed images`).toEqual([]);
  expect.soft(metrics.mainLandmarks, `${label}: main landmarks`).toBe(1);

  const compactViewport = Boolean(
    viewport && (viewport.width <= 480 || viewport.height <= 480),
  );
  if (compactViewport) {
    expect
      .soft(metrics.smallEditableText, `${label}: editable text below 16px`)
      .toEqual([]);
    expect
      .soft(metrics.smallTouchTargets, `${label}: controls below 40px`)
      .toEqual([]);
  }

  if (options.accessibility) {
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze();
    const violations = accessibility.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
    expect.soft(violations, `${label}: accessibility violations`).toEqual([]);
  }

  const runtimeBrowserIssues = monitor
    .flush()
    .filter(
      (issue) =>
        !isExpectedDocumentFailure(issue, page.url(), options.expectedStatus),
    )
    .map(describeBrowserIssue);
  expect.soft(runtimeBrowserIssues, `${label}: browser issues`).toEqual([]);

  if (options.screenshot !== false) {
    if (testInfo.project.name.includes('webkit')) {
      // WebKit can restore a scroll anchor after the long-page paint pass once
      // deferred images settle. Re-anchor viewport evidence at the page start.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY <= 1);
    }
    const screenshotPath = testInfo.outputPath(`${safeName(label)}.png`);
    // Playwright's WebKit full-page capture temporarily changes page styles,
    // which strict CSP correctly rejects. A viewport capture preserves useful
    // Safari evidence without injecting tooling styles into the application.
    await page.screenshot({
      path: screenshotPath,
      fullPage: !testInfo.project.name.includes('webkit'),
    });
    await testInfo.attach(label, {
      path: screenshotPath,
      contentType: 'image/png',
    });

    // Flush capture-only diagnostics so they cannot leak into the next route.
    // Playwright's WebKit screenshot implementation injects a temporary style
    // that strict CSP rejects; runtime diagnostics were already asserted above.
    await page.waitForTimeout(50);
    const evidenceCaptureIssues = monitor
      .flush()
      .filter(
        (issue) =>
          !(
            testInfo.project.name.includes('webkit') &&
            issue.kind === 'console' &&
            issue.level === 'error' &&
            issue.message.startsWith(
              'Refused to apply a stylesheet because its hash, its nonce',
            )
          ),
      )
      .map(describeBrowserIssue);
    expect
      .soft(evidenceCaptureIssues, `${label}: evidence capture browser issues`)
      .toEqual([]);
  }
}

export async function openAndAudit(
  page: Page,
  testInfo: TestInfo,
  path: string,
  label: string,
  monitor: BrowserIssueMonitor,
  options: AuditOptions = {},
) {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
  const expectedPath =
    options.expectedPath ?? new URL(path, page.url()).pathname;
  if (options.expectedStatus) {
    expect
      .soft(response?.status(), `${label}: navigation status`)
      .toBe(options.expectedStatus);
  }
  await expect
    .soft(page, `${label}: final path`)
    .toHaveURL((url) =>
      typeof expectedPath === 'string'
        ? url.pathname === expectedPath
        : expectedPath.test(url.pathname),
    );
  if (options.expectedHeading) {
    await expect
      .soft(
        page.getByRole('heading', {
          exact: typeof options.expectedHeading === 'string',
          level: 1,
          name: options.expectedHeading,
        }),
        `${label}: unique page heading`,
      )
      .toBeVisible();
  }
  if (options.expectedSelector) {
    await expect
      .soft(
        page.locator(options.expectedSelector).first(),
        `${label}: unique page content`,
      )
      .toBeVisible();
  }
  await auditCurrentPage(page, testInfo, label, monitor, options);
}
