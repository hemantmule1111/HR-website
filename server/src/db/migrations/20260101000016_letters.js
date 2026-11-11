// Letters: templates (offer, appointment, experience, relieving, your own) and the letters issued to employees.
const DEFAULTS = [
  ['offer', 'Offer letter', 'Offer of employment', `Dear {{employee_name}},

We are pleased to offer you the position of {{designation}} in the {{department}} department at {{company_name}}, with your date of joining on {{joining_date}}.

Your total monthly gross salary will be {{salary_monthly}} (annual {{salary_annual}}), as per the salary structure discussed with you. Statutory deductions such as Provident Fund, ESIC and Professional Tax will apply as required by law.

Your place of work will be {{work_location}} and you will report to {{manager_name}}.

This offer is subject to satisfactory verification of your documents and references. Please sign and return a copy of this letter to confirm your acceptance.

We look forward to welcoming you to the team.`],
  ['appointment', 'Appointment letter', 'Letter of appointment', `Dear {{employee_name}},

With reference to your acceptance of our offer, we are pleased to appoint you as {{designation}} in the {{department}} department of {{company_name}} with effect from {{joining_date}}. Your employee code is {{employee_code}}.

1. Salary: Your total monthly gross salary will be {{salary_monthly}} (annual {{salary_annual}}). Statutory deductions will be made as required by law.
2. Probation: You will be on probation for {{probation_months}} months from the date of joining. Your appointment will be confirmed in writing on satisfactory performance.
3. Place of work: {{work_location}}. You will report to {{manager_name}}. The company may transfer you to another location or role when the business needs it.
4. Notice period: Either party may end this employment by giving {{notice_period}} notice or salary in lieu of notice.
5. Conduct and confidentiality: You will follow the company's policies and keep all confidential business information private during and after your employment.

Please sign the duplicate copy of this letter as a token of your acceptance of these terms.

We wish you a long and successful association with us.`],
  ['experience', 'Experience letter', 'Experience certificate', `TO WHOM IT MAY CONCERN

This is to certify that {{employee_name}} (Employee Code {{employee_code}}) worked with {{company_name}} as {{designation}} in the {{department}} department from {{joining_date}} to {{last_working_day}}.

During this period we found {{first_name}} to be sincere, hardworking and professional in conduct.

We wish {{first_name}} every success in future endeavours.`],
  ['relieving', 'Relieving letter', 'Relieving letter', `Dear {{employee_name}},

This is to confirm that, further to your resignation dated {{resignation_date}}, you stand relieved from the services of {{company_name}} at the close of business on {{last_working_day}}, in the position of {{designation}}.

We confirm that you have handed over your responsibilities and company property, and that there are no dues pending from you, subject to the final settlement of your accounts.

We thank you for your contribution and wish you the very best for the future.`],
];

export async function up(knex) {
  await knex.schema.createTable('letter_templates', (t) => {
    t.bigIncrements('id');
    t.string('type', 20).notNullable().defaultTo('custom'); // offer | appointment | experience | relieving | custom
    t.string('name', 100).notNullable();
    t.string('title', 150).notNullable(); // the heading printed on the letter
    t.text('body').notNullable(); // text with {{placeholders}}
    t.boolean('is_default').notNullable().defaultTo(false); // the four that come with WorkPilot cannot be deleted, only edited
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });
  await knex.schema.createTable('letters', (t) => {
    t.bigIncrements('id');
    t.bigInteger('employee_id').unsigned().notNullable().references('employees.id').onDelete('CASCADE');
    t.bigInteger('template_id').unsigned().nullable();
    t.string('type', 20).notNullable().defaultTo('custom');
    t.string('title', 150).notNullable();
    t.text('body').notNullable(); // the final wording, fixed when the letter is issued
    t.string('reference_no', 40).notNullable().unique();
    t.date('issued_on').notNullable();
    t.string('signatory_name', 100).nullable();
    t.string('signatory_title', 100).nullable();
    t.bigInteger('issued_by').unsigned().nullable();
    t.timestamps(true, true);
    t.index(['employee_id']);
  });
  for (const [type, name, title, body] of DEFAULTS) await knex('letter_templates').insert({ type, name, title, body, is_default: true, active: true });
}

export async function down() {}
