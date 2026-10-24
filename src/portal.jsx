import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowClockwise,
  ArrowSquareOut,
  Briefcase,
  ChartBar,
  Check,
  GearSix,
  Globe,
  ImageSquare,
  SignOut,
  Trash,
  UploadSimple,
  Users,
  UserPlus,
  XCircle,
} from "@phosphor-icons/react";
import "./portal.css";
import { clientLogo } from "./clientLogos";

const endpoint = (path, options = {}) =>
  fetch(`/api/portal/${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
const statuses = {
  enquiry: ["new", "in_progress", "completed", "archived"],
  application: ["new", "reviewing", "shortlisted", "rejected", "hired"],
};
const labels = {
  new: "New",
  in_progress: "In progress",
  completed: "Completed",
  archived: "Archived",
  reviewing: "Reviewing",
  shortlisted: "Shortlisted",
  rejected: "Rejected",
  hired: "Hired",
};
const setupLabels = {
  database: "Secure database",
  blob: "Private document storage",
  email: "Email delivery",
  session: "Session security",
  accounts: "Portal accounts",
};
function date(value) {
  return value ? new Date(value).toLocaleString() : "—";
}
function Notice({ message, onClose }) {
  return message ? (
    <div className="portal-notice" role="status">
      {message}
      <button onClick={onClose} aria-label="Dismiss">
        <XCircle size={18} />
      </button>
    </div>
  ) : null;
}
function Portal() {
  const [health, setHealth] = useState(null),
    [user, setUser] = useState(null),
    [login, setLogin] = useState({ username: "", password: "" }),
    [tab, setTab] = useState("enquiries");
  const [data, setData] = useState({}),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const manager = user?.role === "manager";
  const coreReady = Boolean(
    health?.config &&
      ["database", "blob", "session", "accounts"].every(
        (key) => health.config[key],
      ),
  );
  const loadHealth = async () => {
    try {
      const r = await endpoint("health");
      setHealth(await r.json());
    } catch {
      setHealth({ ready: false, config: {} });
    }
  };
  const loadUser = async () => {
    try {
      const r = await endpoint("auth/me");
      if (r.ok) {
        const d = await r.json();
        setUser(d.user);
      } else setUser(null);
    } catch {
      setUser(null);
    }
  };
  useEffect(() => {
    (async () => {
      await loadHealth();
      await loadUser();
      setBusy(false);
    })();
  }, []);
  useEffect(() => {
    if (user) loadTab(tab);
  }, [user, tab]);
  const loadTab = async (name) => {
    const paths = {
      dashboard: "dashboard",
      enquiries: "enquiries",
      applications: "applications",
      clients: "clients",
      users: "users",
      settings: "settings",
    };
    try {
      const r = await endpoint(paths[name]);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not load this section.");
      setData((v) => ({ ...v, [name]: d }));
    } catch (e) {
      setError(e.message);
    }
  };
  const mutate = async (path, method, body, success) => {
    setError("");
    try {
      const r = await endpoint(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = r.status === 204 ? {} : await r.json();
      if (!r.ok) throw new Error(d.error || "The request failed.");
      setNotice(success);
      await loadTab(tab);
      await loadHealth();
      return d;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };
  const signIn = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const r = await endpoint("auth/login", {
        method: "POST",
        body: JSON.stringify(login),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Sign in failed.");
      setUser(d.user);
      setLogin((v) => ({ ...v, password: "" }));
      setTab("dashboard");
    } catch (e) {
      setError(e.message);
    }
  };
  const signOut = async () => {
    await mutate("auth/logout", "POST", {}, "Signed out.");
    setUser(null);
    setData({});
  };
  const updateStatus = (kind, id, status) =>
    mutate(
      `${kind === "enquiry" ? "enquiries" : "applications"}/${id}/status`,
      "PATCH",
      { status },
      "Status updated.",
    );
  const nav = [
    ["dashboard", "Overview", ChartBar],
    ["enquiries", "Enquiries", Globe],
    ["applications", "Careers", Briefcase],
    ...(manager
      ? [
          ["clients", "Clients", Users],
          ["users", "Users", UserPlus],
          ["settings", "Settings", GearSix],
        ]
      : []),
  ];
  if (busy) return <div className="portal-loading">Loading FIRECO Portal…</div>;
  if (!user)
    return (
      <div className="portal-page">
        <header className="portal-brand">
          <a href="/">
            <img src="/assets/fireco-logo.svg" alt="FIRECO" />
          </a>
          <span>SECURE OPERATIONS</span>
        </header>
        <main className="portal-login">
          <div className="portal-login-card">
            <div className="portal-symbol">
              <ChartBar size={27} />
            </div>
            <p className="portal-eyebrow">FIRECO TECHNICAL SERVICES</p>
            <h1>Enquiry Portal</h1>
            <p className="portal-muted">
              Sign in to view and manage customer enquiries and applications.
            </p>
            {!coreReady ? (
              <div className="portal-setup">
                <strong>Portal setup is incomplete</strong>
                <p>
                  These services must be connected before sign-in can be
                  enabled:
                </p>
                <ul>
                  {Object.entries(health?.config || {})
                    .filter(([key, ok]) => key !== "email" && !ok)
                    .map(([key]) => (
                      <li key={key}>{setupLabels[key] || key}</li>
                    ))}
                </ul>
                <p>
                  Configure the deployment environment using{" "}
                  <code>PORTAL-SETUP.md</code>, then redeploy.
                </p>
                <button
                  className="portal-secondary"
                  onClick={async () => {
                    setBusy(true);
                    await loadHealth();
                    setBusy(false);
                  }}
                >
                  <ArrowClockwise />
                  Check readiness
                </button>
              </div>
            ) : (
              <>
                {!health?.config.email && (
                  <div className="portal-setup" role="status">
                    <strong>Email notifications are off</strong>
                    <p>
                      New enquiries and applications are saved here for your
                      team to review.
                    </p>
                  </div>
                )}
                <form className="portal-login-form" onSubmit={signIn}>
                  <label>
                    Username
                    <input
                      required
                      autoComplete="username"
                      value={login.username}
                      onChange={(e) =>
                        setLogin({ ...login, username: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Password
                    <input
                      required
                      type="password"
                      autoComplete="current-password"
                      value={login.password}
                      onChange={(e) =>
                        setLogin({ ...login, password: e.target.value })
                      }
                    />
                  </label>
                  {error && (
                    <p className="portal-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="portal-primary">Sign in</button>
                </form>
              </>
            )}
          </div>
          <p className="portal-login-foot">Your safety. Our commitment.</p>
        </main>
      </div>
    );
  return (
    <div className="portal-page">
      <header className="portal-top">
        <a href="/">
          <img src="/assets/fireco-logo.svg" alt="FIRECO" />
        </a>
        <span className="portal-top-label">ENQUIRY MANAGEMENT</span>
        <div className="portal-account">
          <i>{user.role === "manager" ? "M" : "A"}</i>
          <span>
            <b>{user.username}</b>
            <small>{manager ? "Manager" : "Admin · overview & status"}</small>
          </span>
          <button onClick={signOut} title="Sign out">
            <SignOut size={19} />
          </button>
        </div>
      </header>
      <div className="portal-layout">
        <aside className="portal-sidebar">
          <div className="portal-sidebar-title">WORKSPACE</div>
          {nav.map(([key, label, Icon]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key);
                setError("");
              }}
            >
              <Icon size={20} />
              {label}
              {((key === "enquiries" && data.dashboard?.enquiries?.new) ||
                (key === "applications" && data.dashboard?.applications?.new)) >
                0 && <i>New</i>}
            </button>
          ))}
          <div className="portal-sidebar-bottom">
            Encrypted session
            <br />
            Private FIRECO workspace
          </div>
        </aside>
        <main className="portal-content">
          <div className="portal-heading">
            <div>
              <p className="portal-eyebrow">
                {manager ? "MANAGER WORKSPACE" : "ADMIN WORKSPACE"}
              </p>
              <h1>{nav.find((n) => n[0] === tab)?.[1] || "Portal"}</h1>
            </div>
            <button className="portal-secondary" onClick={() => loadTab(tab)}>
              <ArrowClockwise />
              Refresh
            </button>
          </div>
          <Notice message={notice} onClose={() => setNotice("")} />
          {error && (
            <div className="portal-error-box" role="alert">
              {error}
              <button onClick={() => setError("")}>
                <XCircle />
              </button>
            </div>
          )}
          {tab === "dashboard" && (
            <Dashboard
              data={data.dashboard || {}}
              manager={manager}
              reviewRequest={(id, decision) =>
                mutate(
                  `delete-requests/${id}`,
                  "PATCH",
                  { decision },
                  decision === "approve"
                    ? "Deletion request approved and record removed."
                    : "Deletion request declined.",
                )
              }
            />
          )}
          {tab === "enquiries" && (
            <Enquiries
              rows={data.enquiries?.enquiries || []}
              manager={manager}
              updateStatus={updateStatus}
              requestDelete={(id) =>
                mutate(
                  `enquiries/${id}/delete-request`,
                  "POST",
                  {},
                  "Deletion request sent to the manager.",
                )
              }
              remove={(id) =>
                mutate(
                  `enquiries/${id}`,
                  "DELETE",
                  undefined,
                  "Enquiry deleted.",
                )
              }
            />
          )}
          {tab === "applications" && (
            <Applications
              rows={data.applications?.applications || []}
              manager={manager}
              updateStatus={updateStatus}
              requestDelete={(id) =>
                mutate(
                  `applications/${id}/delete-request`,
                  "POST",
                  {},
                  "Deletion request sent to the manager.",
                )
              }
              remove={(id) =>
                mutate(
                  `applications/${id}`,
                  "DELETE",
                  undefined,
                  "Application deleted.",
                )
              }
            />
          )}
          {tab === "clients" && manager && (
            <Clients
              rows={data.clients?.clients || []}
              reload={() => loadTab(tab)}
              mutate={mutate}
            />
          )}
          {tab === "users" && manager && (
            <UserManagement
              rows={data.users?.users || []}
              current={user}
              mutate={mutate}
            />
          )}
          {tab === "settings" && manager && (
            <Settings
              settings={data.settings?.settings || {}}
              mutate={mutate}
            />
          )}
        </main>
      </div>
    </div>
  );
}
function Dashboard({ data, manager, reviewRequest }) {
  return (
    <>
      <div className="portal-metrics">
        {[
          [
            "Enquiries",
            data.enquiries?.total || 0,
            `${data.enquiries?.new || 0} new`,
          ],
          [
            "Applications",
            data.applications?.total || 0,
            `${data.applications?.new || 0} new`,
          ],
          ["Website visits", data.visits30d || 0, "Last 30 days"],
          ["Clients", data.clients?.total || 0, "References"],
        ].map(([title, num, note]) => (
          <article key={title}>
            <span>{title}</span>
            <strong>{num}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>
      {data.deletionRequests?.length > 0 && (
        <section className="portal-panel">
          <div className="portal-panel-title">
            <div>
              <h2>{manager ? "Deletion requests" : "Your deletion requests"}</h2>
              <p>
                {manager
                  ? "Review admin requests before records are permanently removed."
                  : "Track your deletion requests and manager decisions."}
              </p>
            </div>
          </div>
          <div className="portal-request-list">
            {data.deletionRequests.map((request) => (
              <article className="portal-request" key={request.id}>
                <div>
                  <b>{request.record_type === "enquiry" ? "Enquiry" : "Career application"}</b>
                  <span>{request.record_label}</span>
                  <small>
                    Requested by {request.requester_username} · {date(request.created_at)}
                  </small>
                </div>
                {manager ? (
                  <div className="portal-request-actions">
                    <button
                      className="portal-primary"
                      onClick={() => reviewRequest(request.id, "approve")}
                    >
                      Approve deletion
                    </button>
                    <button
                      className="portal-secondary"
                      onClick={() => reviewRequest(request.id, "reject")}
                    >
                      Decline
                    </button>
                  </div>
                ) : (
                  <span className={`portal-status ${request.status === "pending" ? "reviewing" : request.status === "approved" ? "completed" : "rejected"}`}>
                    {request.status === "pending"
                      ? "Pending review"
                      : request.status === "approved"
                        ? "Approved"
                        : "Declined"}
                  </span>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="portal-panel">
        <div className="portal-panel-title">
          <div>
            <h2>Website interactions</h2>
            <p>Aggregated activity; visitor IP addresses are not stored.</p>
          </div>
        </div>
        {data.events?.length ? (
          <div className="portal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Interaction</th>
                  <th>Page / location</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event, i) => (
                  <tr key={i}>
                    <td>{date(event.day)}</td>
                    <td>{event.event.replaceAll("_", " ")}</td>
                    <td>{event.label || "—"}</td>
                    <td>{event.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No website events yet" />
        )}
      </section>
    </>
  );
}
function Empty({ title }) {
  return (
    <div className="portal-empty">
      <span>
        <Check size={21} />
      </span>
      <strong>{title}</strong>
      <p>New submissions will appear here automatically.</p>
    </div>
  );
}
function Filters({
  query,
  setQuery,
  filter,
  setFilter,
  filterLabel,
  options,
  count,
  total,
  placeholder,
}) {
  return (
    <div className="portal-filters">
      <label>
        <span>Search</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
        />
      </label>
      <label>
        <span>{filterLabel}</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <span className="portal-filter-count" aria-live="polite">
        Showing {count} of {total}
      </span>
    </div>
  );
}
function matches(row, fields, query) {
  const needle = query.trim().toLocaleLowerCase();
  return (
    !needle ||
    fields.some((field) =>
      String(row[field] || "")
        .toLocaleLowerCase()
        .includes(needle),
    )
  );
}
function Enquiries({ rows, manager, updateStatus, requestDelete, remove }) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const visible = rows.filter(
    (row) =>
      (filter === "all" || row.status === filter) &&
      matches(
        row,
        ["name", "company", "email", "phone", "location", "details"],
        query,
      ),
  );
  return (
    <section className="portal-panel">
      <div className="portal-panel-title">
        <div>
          <h2>Customer enquiries</h2>
          <p>{rows.length} saved enquiries · newest first</p>
        </div>
      </div>
      <Filters
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        filterLabel="Status"
        options={[
          ["all", "All statuses"],
          ...statuses.enquiry.map((status) => [status, labels[status]]),
        ]}
        count={visible.length}
        total={rows.length}
        placeholder="Name, email, company or project"
      />
      {!rows.length ? (
        <Empty title="No enquiries yet" />
      ) : !visible.length ? (
        <Empty title="No enquiries match these filters" />
      ) : (
        <div className="portal-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Project</th>
                <th>Contact</th>
                <th>Details</th>
                <th>Received</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    <b>{row.name}</b>
                    <small>{row.company || "—"}</small>
                  </td>
                  <td>{row.location}</td>
                  <td>
                    <a href={`mailto:${row.email}`}>{row.email}</a>
                    <small>{row.phone || "—"}</small>
                  </td>
                  <td className="portal-details">{row.details}</td>
                  <td>{date(row.created_at)}</td>
                  <td>
                    <select
                      value={row.status}
                      onChange={(e) =>
                        updateStatus("enquiry", row.id, e.target.value)
                      }
                    >
                      {statuses.enquiry.map((s) => (
                        <option key={s} value={s}>
                          {labels[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {manager ? (
                      <button
                        className="portal-icon-btn danger"
                        onClick={() => remove(row.id)}
                        title="Delete enquiry"
                      >
                        <XCircle />
                      </button>
                    ) : row.deletion_requested ? (
                      <span className="portal-status reviewing">Request pending</span>
                    ) : (
                      <button
                        className="portal-secondary portal-request-button"
                        onClick={() => requestDelete(row.id)}
                      >
                        Request deletion
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Applications({ rows, manager, updateStatus, requestDelete, remove }) {
  const [loading, setLoading] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const visible = rows.filter(
    (row) =>
      (filter === "all" || row.status === filter) &&
      matches(row, ["name", "email", "phone", "role", "message"], query),
  );
  const download = async (row) => {
    setLoading(row.id);
    try {
      const r = await endpoint(`applications/${row.id}/cv`);
      if (!r.ok) throw new Error("Could not download this CV.");
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = row.cv_filename || "applicant-cv.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading("");
    }
  };
  return (
    <section className="portal-panel">
      <div className="portal-panel-title">
        <div>
          <h2>Careers applications</h2>
          <p>{rows.length} saved applications · CVs are stored privately</p>
        </div>
      </div>
      <Filters
        query={query}
        setQuery={setQuery}
        filter={filter}
        setFilter={setFilter}
        filterLabel="Status"
        options={[
          ["all", "All statuses"],
          ...statuses.application.map((status) => [status, labels[status]]),
        ]}
        count={visible.length}
        total={rows.length}
        placeholder="Name, email or role"
      />
      {!rows.length ? (
        <Empty title="No applications yet" />
      ) : !visible.length ? (
        <Empty title="No applications match these filters" />
      ) : (
        <div className="portal-app-list">
          {visible.map((row) => (
            <article className="portal-application" key={row.id}>
              <div className="portal-application-main">
                <div className="portal-avatar">
                  {row.name?.slice(0, 1).toUpperCase()}
                </div>
                <div className="portal-applicant">
                  <h3>{row.name}</h3>
                  <p>{row.role}</p>
                  <div>
                    <a href={`mailto:${row.email}`}>{row.email}</a>
                    {row.phone && <span>{row.phone}</span>}
                  </div>
                  <small>Received {date(row.created_at)}</small>
                  {row.message && (
                    <p className="portal-app-message">{row.message}</p>
                  )}
                </div>
              </div>
              <div className="portal-app-actions">
                <button
                  className="portal-secondary"
                  onClick={() => download(row)}
                  disabled={loading === row.id}
                >
                  <ArrowSquareOut />
                  {loading === row.id ? "Loading…" : "Download CV"}
                </button>
                <select
                  value={row.status}
                  onChange={(e) =>
                    updateStatus("application", row.id, e.target.value)
                  }
                >
                  {statuses.application.map((s) => (
                    <option key={s} value={s}>
                      {labels[s]}
                    </option>
                  ))}
                </select>
                {manager ? (
                  <button
                    className="portal-icon-btn danger"
                    onClick={() => remove(row.id)}
                    title="Delete application"
                  >
                    <XCircle />
                  </button>
                ) : row.deletion_requested ? (
                  <span className="portal-status reviewing">Request pending</span>
                ) : (
                  <button
                    className="portal-secondary portal-request-button"
                    onClick={() => requestDelete(row.id)}
                  >
                    Request deletion
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function ClientLogoControls({ row, mutate }) {
  const [busy, setBusy] = useState(false);
  const logo = clientLogo(
    row.name_en,
    row.logo_pathname
      ? `/api/portal/public/client-logo/${encodeURIComponent(row.id)}?v=${encodeURIComponent(row.updated_at || "")}`
      : null,
    row.logo_disabled,
  );
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      alert("Choose a PNG, JPG or WebP logo up to 2 MB.");
      return;
    }
    setBusy(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await mutate(
        `clients/${row.id}/logo`,
        "POST",
        { filename: file.name, data },
        logo ? "Logo replaced." : "Logo uploaded.",
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await mutate(
        `clients/${row.id}/logo`,
        "DELETE",
        undefined,
        "Logo removed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="portal-client-logo">
      <div className="portal-client-logo-preview">
        {logo ? <img src={logo} alt="" /> : <ImageSquare size={22} />}
      </div>
      <div className="portal-client-logo-actions">
        <label className="portal-secondary">
          {busy ? "Working…" : logo ? "Replace logo" : "Upload logo"}
          <UploadSimple />
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={upload}
            disabled={busy}
          />
        </label>
        {logo && (
          <button
            type="button"
            className="portal-logo-remove"
            onClick={remove}
            disabled={busy}
          >
            <Trash />
            Remove logo
          </button>
        )}
      </div>
    </div>
  );
}
function Clients({ rows, reload, mutate }) {
  const blank = {
    name_en: "",
    name_ar: "",
    sector: "Government",
    location_en: "",
    location_ar: "",
  };
  const [form, setForm] = useState(blank),
    [editing, setEditing] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all");
  const sectors = [
    ...new Set(rows.map((row) => row.sector).filter(Boolean)),
  ].sort();
  const visible = rows.filter(
    (row) =>
      (filter === "all" || row.sector === filter) &&
      matches(
        row,
        ["name_en", "name_ar", "sector", "location_en", "location_ar"],
        query,
      ),
  );
  const submit = async (e) => {
    e.preventDefault();
    const result = await mutate(
      editing ? `clients/${editing}` : "clients",
      editing ? "PUT" : "POST",
      form,
      editing ? "Client updated." : "Client added.",
    );
    if (result) {
      setForm(blank);
      setEditing("");
      reload();
    }
  };
  const edit = (row) => {
    setEditing(row.id);
    setForm({
      name_en: row.name_en || "",
      name_ar: row.name_ar || "",
      sector: row.sector || "Government",
      location_en: row.location_en || "",
      location_ar: row.location_ar || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <>
      <section className="portal-panel">
        <div className="portal-panel-title">
          <div>
            <h2>{editing ? "Edit client" : "Add a client"}</h2>
            <p>Client changes are saved to the live website data.</p>
          </div>
        </div>
        <form className="portal-inline-form" onSubmit={submit}>
          <label>
            English name
            <input
              required
              value={form.name_en}
              onChange={(e) => setForm({ ...form, name_en: e.target.value })}
            />
          </label>
          <label>
            Arabic name
            <input
              required
              dir="rtl"
              value={form.name_ar}
              onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
            />
          </label>
          <label>
            Sector
            <input
              required
              value={form.sector}
              onChange={(e) => setForm({ ...form, sector: e.target.value })}
            />
          </label>
          <label>
            Location (English)
            <input
              value={form.location_en}
              onChange={(e) =>
                setForm({ ...form, location_en: e.target.value })
              }
            />
          </label>
          <label>
            Location (Arabic)
            <input
              dir="rtl"
              value={form.location_ar}
              onChange={(e) =>
                setForm({ ...form, location_ar: e.target.value })
              }
            />
          </label>
          <div className="portal-form-actions">
            <button className="portal-primary">
              {editing ? "Save changes" : "Add client"}
            </button>
            {editing && (
              <button
                type="button"
                className="portal-secondary"
                onClick={() => {
                  setForm(blank);
                  setEditing("");
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
      <section className="portal-panel">
        <div className="portal-panel-title">
          <div>
            <h2>Website clients</h2>
            <p>{rows.length} client and project references</p>
          </div>
        </div>
        <Filters
          query={query}
          setQuery={setQuery}
          filter={filter}
          setFilter={setFilter}
          filterLabel="Sector"
          options={[
            ["all", "All sectors"],
            ...sectors.map((sector) => [sector, sector]),
          ]}
          count={visible.length}
          total={rows.length}
          placeholder="English or Arabic name, location"
        />
        {!visible.length ? (
          <Empty
            title={
              rows.length ? "No clients match these filters" : "No clients yet"
            }
          />
        ) : (
          <div className="portal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Logo</th>
                  <th>Client</th>
                  <th>Arabic</th>
                  <th>Sector</th>
                  <th>Location</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <ClientLogoControls row={row} mutate={mutate} />
                    </td>
                    <td>
                      <b>{row.name_en}</b>
                    </td>
                    <td dir="rtl">{row.name_ar}</td>
                    <td>{row.sector}</td>
                    <td>{row.location_en || row.location_ar || "—"}</td>
                    <td className="portal-row-actions">
                      <button
                        className="portal-secondary"
                        onClick={() => edit(row)}
                      >
                        Edit
                      </button>
                      <button
                        className="portal-icon-btn danger"
                        onClick={() =>
                          mutate(
                            `clients/${row.id}`,
                            "DELETE",
                            undefined,
                            "Client deleted.",
                          )
                        }
                        title="Delete client"
                      >
                        <XCircle />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
function UserManagement({ rows, current, mutate }) {
  const [form, setForm] = useState({
      username: "",
      password: "",
      role: "admin",
    }),
    [reset, setReset] = useState({});
  const create = async (e) => {
    e.preventDefault();
    const result = await mutate("users", "POST", form, "User account created.");
    if (result) setForm({ username: "", password: "", role: "admin" });
  };
  return (
    <>
      <section className="portal-panel">
        <div className="portal-panel-title">
          <div>
            <h2>Add a portal account</h2>
            <p>
              Passwords are hashed before storage and cannot be viewed later.
            </p>
          </div>
        </div>
        <form className="portal-inline-form" onSubmit={create}>
          <label>
            Username
            <input
              required
              minLength="3"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label>
            Temporary password
            <input
              required
              type="password"
              minLength="12"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label>
            Role
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="admin">Admin · overview & status</option>
              <option value="manager">Manager · full access</option>
            </select>
          </label>
          <button className="portal-primary">Create account</button>
        </form>
      </section>
      <section className="portal-panel">
        <div className="portal-panel-title">
          <div>
            <h2>Portal users</h2>
            <p>At least one active manager account must remain.</p>
          </div>
        </div>
        <div className="portal-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>State</th>
                <th>Reset password</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <b>{row.username}</b>
                    {row.username.toLowerCase() ===
                      current.username.toLowerCase() && (
                      <small>Current account</small>
                    )}
                  </td>
                  <td>
                    <select
                      value={row.role}
                      onChange={(e) =>
                        mutate(
                          `users/${row.id}`,
                          "PATCH",
                          { role: e.target.value },
                          "User role updated.",
                        )
                      }
                    >
                      <option value="admin">Admin</option>
                      <option value="manager">Manager</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={row.active ? "true" : "false"}
                      onChange={(e) =>
                        mutate(
                          `users/${row.id}`,
                          "PATCH",
                          { active: e.target.value === "true" },
                          "Account state updated.",
                        )
                      }
                    >
                      <option value="true">Active</option>
                      <option value="false">Disabled</option>
                    </select>
                  </td>
                  <td>
                    <div className="portal-reset">
                      <input
                        type="password"
                        placeholder="12+ characters"
                        autoComplete="new-password"
                        value={reset[row.id] || ""}
                        onChange={(e) =>
                          setReset({ ...reset, [row.id]: e.target.value })
                        }
                      />
                      <button
                        className="portal-secondary"
                        onClick={async () => {
                          if ((reset[row.id] || "").length < 12)
                            return alert("Use at least 12 characters.");
                          const result = await mutate(
                            `users/${row.id}`,
                            "PATCH",
                            { password: reset[row.id] },
                            "Password reset.",
                          );
                          if (result) setReset({ ...reset, [row.id]: "" });
                        }}
                      >
                        Set
                      </button>
                    </div>
                  </td>
                  <td>
                    <button
                      disabled={row.id === current.id}
                      className="portal-icon-btn danger"
                      title="Delete account"
                      onClick={() =>
                        mutate(
                          `users/${row.id}`,
                          "DELETE",
                          undefined,
                          "User account deleted.",
                        )
                      }
                    >
                      <XCircle />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
function Settings({ settings, mutate }) {
  const [form, setForm] = useState(settings),
    [profileFile, setProfileFile] = useState(null),
    [uploading, setUploading] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  const upload = async (e) => {
    e.preventDefault();
    if (!profileFile) return;
    setUploading(true);
    try {
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(profileFile);
      });
      const result = await mutate(
        "profile",
        "PUT",
        { filename: profileFile.name, pdf: encoded },
        "Company profile PDF updated.",
      );
      if (result) setProfileFile(null);
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <section className="portal-panel">
        <div className="portal-panel-title">
          <div>
            <h2>Notification settings</h2>
            <p>
              New submissions are saved in the portal and sent to these team
              addresses.
            </p>
          </div>
        </div>
        <form
          className="portal-settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutate("settings", "PUT", form, "Settings saved.");
          }}
        >
          <label>
            Customer enquiry notifications
            <input
              type="email"
              required
              value={form.enquiry_email || ""}
              onChange={(e) =>
                setForm({ ...form, enquiry_email: e.target.value })
              }
            />
          </label>
          <label>
            Careers application notifications
            <input
              type="email"
              required
              value={form.careers_email || ""}
              onChange={(e) =>
                setForm({ ...form, careers_email: e.target.value })
              }
            />
          </label>
          <button className="portal-primary">Save notification settings</button>
        </form>
      </section>
      <section className="portal-panel">
        <div className="portal-panel-title">
          <div>
            <h2>Company profile PDF</h2>
            <p>
              Upload a replacement PDF; the public profile link will serve it
              from private storage.
            </p>
          </div>
          <a
            className="portal-secondary"
            href="/api/portal/public/profile"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ArrowSquareOut />
            View profile
          </a>
        </div>
        <form className="portal-settings-form" onSubmit={upload}>
          <label>
            Replacement PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              required
              onChange={(e) => setProfileFile(e.target.files?.[0] || null)}
            />
          </label>
          <p className="portal-muted">
            {form.profile_pathname
              ? "A custom profile PDF is active."
              : "The site currently uses its packaged profile PDF."}{" "}
            Maximum 3 MB.
          </p>
          <button
            className="portal-primary"
            disabled={!profileFile || uploading}
          >
            {uploading ? "Uploading…" : "Upload and publish profile"}
          </button>
        </form>
      </section>
    </>
  );
}

createRoot(document.getElementById("portal-root")).render(<Portal />);
