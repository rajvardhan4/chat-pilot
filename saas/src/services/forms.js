/**
 * Pre-chat forms, fields and submissions (leads).
 *
 * Validation runs server-side on the SaaS, so a tampered widget cannot bypass
 * required fields or inject extra columns.
 */
import { col, nowIso, toBool, withTransaction } from "../db/mongo.js";
import { conflict, notFound, validationFailed } from "../core/errors.js";
import { newId } from "../core/crypto.js";
import { stripControlChars } from "../core/validate.js";
import { audit } from "./audit.js";
import { getWebsiteForAccount } from "./websites.js";
import { notifyNewLead } from "./notifications.js";
export const FIELD_TYPES = ['text', 'email', 'phone', 'textarea', 'dropdown', 'checkbox', 'radio'];
function toFieldRow(d) {
    return {
        id: d._id, form_id: d.form_id, field_key: d.field_key, type: d.type, label: d.label,
        placeholder: d.placeholder, options: d.options, required: d.required, enabled: d.enabled, sort_order: d.sort_order,
    };
}
function toFormRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
export async function listForms(accountId, websiteId) {
    const forms = await col('forms')
        .find({ website_id: websiteId, account_id: accountId })
        .sort({ is_default: -1, created_at: 1 })
        .toArray();
    const out = [];
    for (const f of forms)
        out.push({ ...toFormRow(f), fields: await listFields(f._id) });
    return out;
}
export async function listFields(formId) {
    const docs = await col('form_fields').find({ form_id: formId }).sort({ sort_order: 1 }).toArray();
    return docs.map(toFieldRow);
}
export async function getForm(accountId, websiteId, formId) {
    const form = await col('forms').findOne({ _id: formId, website_id: websiteId, account_id: accountId });
    if (!form)
        throw notFound('Form not found.');
    return { ...toFormRow(form), fields: await listFields(form._id) };
}
/** The form the widget should render, honouring widget_settings.active_form_id. */
export async function getActiveForm(accountId, websiteId) {
    const settings = await col('widget_settings').findOne({ website_id: websiteId, account_id: accountId }, { projection: { active_form_id: 1 } });
    let form = null;
    if (settings?.active_form_id) {
        form = await col('forms').findOne({ _id: settings.active_form_id, website_id: websiteId, status: 'active' });
    }
    if (!form) {
        form = await col('forms').findOne({ website_id: websiteId, account_id: accountId, is_default: 1, status: 'active' });
    }
    if (!form)
        return null;
    const fields = (await listFields(form._id)).filter((f) => toBool(f.enabled));
    if (!fields.length)
        return null;
    return { ...toFormRow(form), fields };
}
function normaliseKey(input, index) {
    const key = String(input ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return key || 'field_' + (index + 1);
}
export async function saveForm(accountId, websiteId, input, actorId) {
    await getWebsiteForAccount(accountId, websiteId);
    const name = input.name.trim();
    if (!name)
        throw validationFailed('Give this form a name.', { name: 'A form name is required.' });
    if (!input.fields.length) {
        throw validationFailed('Add at least one field.', { fields: 'At least one field is required.' });
    }
    const seenKeys = new Set();
    const fields = input.fields.map((f, index) => {
        if (!FIELD_TYPES.includes(f.type)) {
            throw validationFailed('Unsupported field type: ' + f.type, { fields: 'Unsupported field type.' });
        }
        const label = stripControlChars(f.label ?? '').trim();
        if (!label)
            throw validationFailed('Every field needs a label.', { fields: 'Every field needs a label.' });
        let key = normaliseKey(f.fieldKey ?? label, index);
        while (seenKeys.has(key))
            key = key + '_' + (index + 1);
        seenKeys.add(key);
        if ((f.type === 'dropdown' || f.type === 'radio') && !(f.options ?? '').trim()) {
            throw validationFailed('Add options for "' + label + '".', { fields: 'Choice fields need options.' });
        }
        return {
            key,
            type: f.type,
            label: label.slice(0, 120),
            placeholder: stripControlChars(f.placeholder ?? '').trim().slice(0, 160),
            options: stripControlChars(f.options ?? '').trim().slice(0, 2000),
            required: f.required ? 1 : 0,
            enabled: f.enabled === false ? 0 : 1,
            order: index,
        };
    });
    const now = nowIso();
    const formId = input.formId ?? newId();
    await withTransaction(async (session) => {
        if (input.formId) {
            const existing = await col('forms').findOne({ _id: input.formId, website_id: websiteId, account_id: accountId }, { session });
            if (!existing)
                throw notFound('Form not found.');
            await col('forms').updateOne({ _id: formId }, { $set: { name, status: input.status ?? existing.status, updated_at: now } }, { session });
            await col('form_fields').deleteMany({ form_id: formId }, { session });
        }
        else {
            await col('forms').insertOne({
                _id: formId, account_id: accountId, website_id: websiteId, name,
                is_default: 0, status: input.status ?? 'active', created_at: now, updated_at: now,
            }, { session });
        }
        for (const f of fields) {
            await col('form_fields').insertOne({
                _id: newId(), account_id: accountId, website_id: websiteId, form_id: formId,
                field_key: f.key, type: f.type, label: f.label, placeholder: f.placeholder,
                options: f.options, required: f.required, enabled: f.enabled, sort_order: f.order,
            }, { session });
        }
    });
    await audit({
        accountId, websiteId, actorType: 'user', actorId,
        action: input.formId ? 'form.updated' : 'form.created', targetType: 'form', targetId: formId,
    });
    return getForm(accountId, websiteId, formId);
}
export async function setDefaultForm(accountId, websiteId, formId) {
    await getForm(accountId, websiteId, formId);
    await withTransaction(async (session) => {
        await col('forms').updateMany({ website_id: websiteId, account_id: accountId }, { $set: { is_default: 0 } }, { session });
        await col('forms').updateOne({ _id: formId }, { $set: { is_default: 1 } }, { session });
        await col('widget_settings').updateOne({ website_id: websiteId, account_id: accountId }, { $set: { active_form_id: formId, prechat_enabled: 1, updated_at: nowIso() } }, { session });
    });
}
/**
 * Chooses the widget's pre-chat form. Passing null is an explicit "no pre-chat
 * form" instruction, not "fall back to the default" - the two states are
 * different and visitors must see the difference.
 */
export async function setActiveForm(accountId, websiteId, formId) {
    if (formId)
        await getForm(accountId, websiteId, formId);
    await col('widget_settings').updateOne({ website_id: websiteId, account_id: accountId }, { $set: { active_form_id: formId, prechat_enabled: formId ? 1 : 0, updated_at: nowIso() } });
}
export async function duplicateForm(accountId, websiteId, formId, actorId) {
    const source = await getForm(accountId, websiteId, formId);
    return saveForm(accountId, websiteId, {
        name: 'Copy of ' + source.name,
        status: 'active',
        fields: source.fields.map((f) => ({
            fieldKey: f.field_key,
            type: f.type,
            label: f.label,
            placeholder: f.placeholder,
            options: f.options,
            required: toBool(f.required),
            enabled: toBool(f.enabled),
        })),
    }, actorId);
}
export async function deleteForm(accountId, websiteId, formId) {
    const form = await getForm(accountId, websiteId, formId);
    const count = await col('forms').countDocuments({ website_id: websiteId, account_id: accountId });
    if (count <= 1)
        throw conflict('You cannot delete the only form for this website.');
    await withTransaction(async (session) => {
        await col('form_fields').deleteMany({ form_id: formId }, { session });
        await col('form_submissions').deleteMany({ form_id: formId }, { session });
        await col('forms').deleteOne({ _id: formId, website_id: websiteId, account_id: accountId }, { session });
        if (form.is_default) {
            const next = await col('forms').findOne({ website_id: websiteId, account_id: accountId }, { session });
            if (next) {
                await col('forms').updateMany({ website_id: websiteId, account_id: accountId }, { $set: { is_default: 0 } }, { session });
                await col('forms').updateOne({ _id: next._id }, { $set: { is_default: 1 } }, { session });
                await col('widget_settings').updateOne({ website_id: websiteId, account_id: accountId }, { $set: { active_form_id: next._id, prechat_enabled: 1, updated_at: nowIso() } }, { session });
            }
        }
        await col('widget_settings').updateOne({ website_id: websiteId, active_form_id: formId }, { $set: { active_form_id: null } }, { session });
    });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/**
 * Validates a visitor submission against the form definition on the server.
 * Unknown keys are dropped; required and format rules are enforced here.
 */
export async function submitForm(accountId, websiteId, input) {
    const form = await getForm(accountId, websiteId, input.formId);
    if (form.status !== 'active')
        throw notFound('This form is no longer available.');
    const errors = {};
    const clean = {};
    for (const field of form.fields) {
        if (!toBool(field.enabled))
            continue;
        const raw = input.values[field.field_key];
        const value = stripControlChars(typeof raw === 'string' ? raw : raw == null ? '' : String(raw))
            .trim()
            .slice(0, field.type === 'textarea' ? 4000 : 300);
        if (toBool(field.required) && !value) {
            errors[field.field_key] = field.label + ' is required.';
            continue;
        }
        if (!value)
            continue;
        if (field.type === 'email' && !EMAIL_RE.test(value)) {
            errors[field.field_key] = 'Enter a valid email address for ' + field.label + '.';
            continue;
        }
        if (field.type === 'phone' && value.replace(/\D/g, '').length < 5) {
            errors[field.field_key] = 'Enter a valid phone number for ' + field.label + '.';
            continue;
        }
        if (field.type === 'dropdown' || field.type === 'radio') {
            const allowed = field.options.split('\n').map((o) => o.trim()).filter(Boolean);
            if (allowed.length && !allowed.includes(value)) {
                errors[field.field_key] = 'Choose one of the available options for ' + field.label + '.';
                continue;
            }
        }
        clean[field.field_key] = value;
    }
    if (Object.keys(errors).length) {
        throw validationFailed(Object.values(errors)[0], errors);
    }
    const id = newId();
    const name = clean.name ?? clean.full_name ?? '';
    const email = clean.email ?? '';
    const phone = clean.phone ?? '';
    const conversation = await col('conversations').findOne({ website_id: websiteId, session_key: input.sessionKey }, { projection: { _id: 1 } });
    const visitor = input.visitorKey
        ? await col('visitors').findOne({ website_id: websiteId, visitor_key: input.visitorKey }, { projection: { _id: 1 } })
        : undefined;
    await col('form_submissions').insertOne({
        _id: id,
        account_id: accountId,
        website_id: websiteId,
        form_id: form.id,
        conversation_id: conversation?._id ?? null,
        visitor_id: visitor?._id ?? null,
        session_key: input.sessionKey,
        name, email, phone,
        fields: JSON.stringify(clean),
        page_url: (input.pageUrl ?? '').slice(0, 2000),
        created_at: nowIso(),
    });
    if (conversation) {
        const set = { form_id: form.id };
        if (name)
            set.visitor_name = name;
        if (email)
            set.visitor_email = email;
        if (phone)
            set.visitor_phone = phone;
        await col('conversations').updateOne({ _id: conversation._id, website_id: websiteId }, { $set: set });
    }
    await notifyNewLead({
        account_id: accountId, website_id: websiteId, id,
        name, email, phone, page_url: input.pageUrl ?? '',
    });
    return { id, name, email, phone };
}
function toSubmissionRow(d) {
    const { _id, ...rest } = d;
    return { id: _id, ...rest };
}
export async function listSubmissions(accountId, websiteId, filter = {}) {
    const query = { website_id: websiteId, account_id: accountId };
    if (filter.formId)
        query.form_id = filter.formId;
    if (filter.search) {
        const pattern = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query.$or = [
            { name: { $regex: pattern, $options: 'i' } },
            { email: { $regex: pattern, $options: 'i' } },
            { phone: { $regex: pattern, $options: 'i' } },
        ];
    }
    const docs = await col('form_submissions')
        .find(query)
        .sort({ created_at: -1 })
        .skip(filter.offset ?? 0)
        .limit(Math.min(filter.limit ?? 50, 200))
        .toArray();
    return docs.map(toSubmissionRow);
}
export async function getSubmission(accountId, websiteId, id) {
    const row = await col('form_submissions').findOne({ _id: id, website_id: websiteId, account_id: accountId });
    if (!row)
        throw notFound('Submission not found.');
    return toSubmissionRow(row);
}
export async function deleteSubmission(accountId, websiteId, id) {
    await getSubmission(accountId, websiteId, id);
    await col('form_submissions').deleteOne({ _id: id, website_id: websiteId, account_id: accountId });
}
