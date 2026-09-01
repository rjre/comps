import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

async function saveProfile(formData: FormData) {
  "use server";

  const data = {
    title: String(formData.get("title") ?? "") || null,
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    addressLine1: String(formData.get("addressLine1") ?? "") || null,
    addressLine2: String(formData.get("addressLine2") ?? "") || null,
    city: String(formData.get("city") ?? "") || null,
    region: String(formData.get("region") ?? "") || null,
    postalCode: String(formData.get("postalCode") ?? "") || null,
    country: String(formData.get("country") ?? "") || null,
    dateOfBirth: (() => {
      const raw = String(formData.get("dateOfBirth") ?? "");
      return raw ? new Date(raw) : null;
    })(),
  };

  const existing = await prisma.profile.findFirst();
  if (existing) {
    await prisma.profile.update({ where: { id: existing.id }, data });
  } else {
    await prisma.profile.create({ data });
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
}

export default async function ProfilePage() {
  const profile = await prisma.profile.findFirst();

  return (
    <main>
      <h1>Profile</h1>
      <p className="lede">
        This is the single identity used for every automated entry — entering the same giveaway
        under multiple identities is not supported here, by design.
      </p>
      <form action={saveProfile} className="card">
        <label>
          Title
          <select name="title" defaultValue={profile?.title ?? ""}>
            <option value="">(none)</option>
            <option value="Mr">Mr</option>
            <option value="Mrs">Mrs</option>
            <option value="Ms">Ms</option>
            <option value="Miss">Miss</option>
            <option value="Mx">Mx</option>
            <option value="Dr">Dr</option>
          </select>
        </label>
        <label>
          First name
          <input name="firstName" defaultValue={profile?.firstName} required />
        </label>
        <label>
          Last name
          <input name="lastName" defaultValue={profile?.lastName} required />
        </label>
        <label>
          Email
          <input name="email" type="email" defaultValue={profile?.email} required />
        </label>
        <label>
          Phone
          <input name="phone" defaultValue={profile?.phone ?? ""} />
        </label>
        <label>
          Address line 1
          <input name="addressLine1" defaultValue={profile?.addressLine1 ?? ""} />
        </label>
        <label>
          Address line 2
          <input name="addressLine2" defaultValue={profile?.addressLine2 ?? ""} />
        </label>
        <label>
          City
          <input name="city" defaultValue={profile?.city ?? ""} />
        </label>
        <label>
          Region/State
          <input name="region" defaultValue={profile?.region ?? ""} />
        </label>
        <label>
          Postal code
          <input name="postalCode" defaultValue={profile?.postalCode ?? ""} />
        </label>
        <label>
          Country
          <input name="country" defaultValue={profile?.country ?? ""} />
        </label>
        <label>
          Date of birth (some competitions require age verification)
          <input
            name="dateOfBirth"
            type="date"
            defaultValue={profile?.dateOfBirth ? profile.dateOfBirth.toISOString().slice(0, 10) : ""}
          />
        </label>
        <button type="submit">Save</button>
      </form>
    </main>
  );
}
