import { describe, expect, it } from "vitest";
import { formAdvertisesEntry, vetoReasonFor } from "./generic";

// The descriptors here are the real action/id/class strings from pages the
// discovery pipeline actually surfaced.
describe("vetoReasonFor", () => {
  // The one that mattered: this form was picked as `form:first` on a blog
  // competition page and submitted with the user's real name and email.
  it("vetoes a WordPress comment form", () => {
    expect(vetoReasonFor("https://stressedmum.co.uk/wp-comments-post.php commentform comment-form")).toBe(
      "comment form",
    );
  });

  it("vetoes a search form", () => {
    expect(vetoReasonFor("https://example.com/ searchform search")).toBe("search form");
  });

  it("vetoes a login form", () => {
    expect(vetoReasonFor("/account/login loginform")).toBe("login/registration form");
  });

  it("vetoes a newsletter signup", () => {
    expect(vetoReasonFor("/subscribe mc4wp-form newsletter")).toBe("newsletter signup form");
  });

  it("vetoes a contact form", () => {
    expect(vetoReasonFor("/contact contact-form")).toBe("contact/feedback form");
  });

  it("allows a genuine competition entry form", () => {
    expect(vetoReasonFor("/competition/enter competition-entry-form")).toBeNull();
  });

  it("allows an unremarkable form with no telling markup", () => {
    expect(vetoReasonFor("/submit form-abc123")).toBeNull();
  });
});

describe("formAdvertisesEntry", () => {
  it("recognises a competition entry form", () => {
    expect(formAdvertisesEntry("/competition/enter comp-entry")).toBe(true);
  });

  it("recognises a giveaway form", () => {
    expect(formAdvertisesEntry("/giveaway-signup")).toBe(true);
  });

  it("does not claim an anonymous form is an entry form", () => {
    expect(formAdvertisesEntry("/submit form-abc123")).toBe(false);
  });
});
