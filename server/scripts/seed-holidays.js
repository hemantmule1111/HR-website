// Adds Indian public holidays for 2027-2029 (safe to re-run: existing dates are left untouched).
// Moon-sighting festivals are marked "(tentative)" - confirm against the official gazette each year.
import 'dotenv/config';
import db from '../src/db/index.js';

const T = ' (tentative)';
const HOLIDAYS = {
  2027: [
    ['01-01', "New Year's Day"], ['01-26', 'Republic Day'], ['03-06', 'Maha Shivaratri'], ['03-10', `Ramzan Id${T}`], ['03-22', 'Holi'],
    ['03-26', 'Good Friday'], ['04-14', 'Ambedkar Jayanti'], ['04-15', 'Rama Navami'], ['04-19', 'Mahavir Jayanti'], ['05-17', `Bakrid${T}`],
    ['05-20', 'Buddha Purnima'], ['06-16', `Muharram${T}`], ['08-15', 'Independence Day'], ['08-25', 'Janmashtami'], ['10-02', 'Gandhi Jayanti'],
    ['10-09', 'Dussehra'], ['10-29', 'Diwali'], ['11-14', 'Guru Nanak Jayanti'], ['12-25', 'Christmas'],
  ],
  2028: [
    ['01-01', "New Year's Day"], ['01-26', 'Republic Day'], ['02-23', 'Maha Shivaratri'], ['02-27', `Ramzan Id${T}`], ['03-11', 'Holi'],
    ['04-03', 'Rama Navami'], ['04-07', 'Mahavir Jayanti'], ['04-14', 'Good Friday / Ambedkar Jayanti'], ['05-06', `Bakrid${T}`],
    ['06-04', `Muharram${T}`], ['08-13', 'Janmashtami'], ['08-15', 'Independence Day'], ['09-27', 'Dussehra'], ['10-02', 'Gandhi Jayanti'],
    ['10-17', 'Diwali'], ['12-25', 'Christmas'],
  ],
  2029: [
    ['01-01', "New Year's Day"], ['01-26', 'Republic Day'], ['02-11', 'Maha Shivaratri'], ['02-15', `Ramzan Id${T}`], ['03-01', 'Holi'],
    ['03-30', 'Good Friday'], ['04-14', 'Ambedkar Jayanti'], ['04-22', 'Rama Navami'], ['04-25', `Bakrid${T}`], ['04-26', 'Mahavir Jayanti'],
    ['05-25', `Muharram${T}`], ['08-15', 'Independence Day'], ['09-01', 'Janmashtami'], ['10-02', 'Gandhi Jayanti'], ['10-16', 'Dussehra'],
    ['11-05', 'Diwali'], ['12-25', 'Christmas'],
  ],
};

for (const [year, list] of Object.entries(HOLIDAYS)) {
  for (const [md, name] of list) {
    await db('holidays').insert({ date: `${year}-${md}`, name }).onConflict('date').ignore();
  }
}
console.log(`Holiday seed done (${Object.values(HOLIDAYS).flat().length} entries processed).`);
await db.destroy();
