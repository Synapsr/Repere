import { expect, test, type Locator, type Page } from "@playwright/test";
import frErrors from "../../src/i18n/messages/fr/errors.json";

const email = "clipboard-review@example.test";
const user = { id: "clipboard-user", name: "Camille", email };

async function openCodeStep(page: Page) {
  // These tests cover clipboard UI behavior, without consuming SMTP/OTP quotas.
  await page.route("**/api/auth/request", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/login?next=/demo-site");
  await page.getByLabel("Votre adresse email").fill(email);
  await page.getByRole("button", { name: "Recevoir mon code", exact: true }).click();
  const input = page.getByLabel("Code de connexion", { exact: true });
  await expect(input).toBeEditable();
  return input;
}

async function paste(input: Locator, text: string, repeatAndSubmit = false) {
  // DOM clipboard events exercise the React handler without system clipboard permissions.
  // Firefox strips constructor-supplied data on untrusted paste events, so define the
  // clipboard payload on the event itself to simulate a user's readable clipboard.
  await input.evaluate(
    (element, { text, repeatAndSubmit }) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      const dispatch = () => {
        const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: clipboardData });
        element.dispatchEvent(event);
      };
      dispatch();
      if (repeatAndSubmit) {
        dispatch();
        (element as HTMLInputElement).form?.requestSubmit();
      }
    },
    { text, repeatAndSubmit },
  );
}

test("pasting a complete OTP signs in automatically and sends one verification request", async ({
  page,
}) => {
  const verifications: unknown[] = [];
  let release = () => {};
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/verify", async (route) => {
    verifications.push(route.request().postDataJSON());
    await responseGate;
    await route.fulfill({ json: { user } });
  });
  try {
    const input = await openCodeStep(page);
    // Duplicate paste and form submission occur in the same turn, before a pending render.
    await paste(input, " \n012-345\u00a0", true);
    await expect.poll(() => verifications.length).toBe(1);
    expect(verifications).toEqual([{ email, code: "012345" }]);
    await expect(input).toHaveValue("012345");
    await expect(input).not.toBeEditable();
    await expect(
      page.getByRole("button", { name: "Changer d’adresse", exact: true }),
    ).toBeDisabled();
    await paste(input, "654321", true);
    release();
    await expect(page).toHaveURL(/\/demo-site$/);
    expect(verifications).toEqual([{ email, code: "012345" }]);
  } finally {
    release();
  }
});

test("incomplete or malformed pastes do not submit, and a failed pasted code can be retried manually", async ({
  page,
}) => {
  const verifications: unknown[] = [];
  await page.route("**/api/auth/verify", async (route) => {
    verifications.push(route.request().postDataJSON());
    if (verifications.length === 1) {
      await route.fulfill({
        status: 400,
        json: { code: "OTP_INVALID", error: frErrors.OTP_INVALID },
      });
    } else {
      await route.fulfill({ json: { user } });
    }
  });
  const input = await openCodeStep(page);
  await paste(input, "12 3");
  await expect(input).toHaveValue("123");
  await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeDisabled();
  await paste(input, "1234567");
  await paste(input, "code: 012345");
  await expect(input).toHaveValue("123");
  expect(verifications).toEqual([]);

  await paste(input, "012 345");
  await expect(page.getByText(frErrors.OTP_INVALID, { exact: true })).toBeVisible();
  await expect(input).toBeEditable();
  await expect(input).toHaveValue("012345");
  expect(verifications).toEqual([{ email, code: "012345" }]);

  // Typing remains an explicit submission path; the accessible button still works after error.
  await input.fill("654321");
  await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/demo-site$/);
  expect(verifications).toEqual([
    { email, code: "012345" },
    { email, code: "654321" },
  ]);
});
