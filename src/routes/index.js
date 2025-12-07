import express from 'express';
import { getLocations } from '../controllers/locationsController.js';
import { getDoctors, getDoctorsByTreatment } from '../controllers/doctorsController.js';
import { getSlots } from '../controllers/slotsController.js';
import { getPatientByPhone, upsertPatient, getPatientAppointments } from '../controllers/patientController.js';
import { addAppointment, deleteAppointment, cancelByPhone } from '../controllers/appointmentsController.js';
import { getCalendarDays, getCalendarSlots } from '../controllers/calendarController.js';
import { getSchedules, getAvailableDoctors } from '../controllers/scheduleController.js';
import { searchDoctors, getTreatments, addLog } from '../controllers/auxController.js';

const router = express.Router();

router.get('/locations', getLocations);
router.get('/doctors', getDoctors);
router.get('/doctors/by-treatment', getDoctorsByTreatment);
router.get('/slots', getSlots);
router.get('/patient', getPatientByPhone);
router.post('/patient/upsert', upsertPatient);
router.get('/patient/appointments', getPatientAppointments);

router.get('/calendar/days', getCalendarDays);
router.get('/calendar/slots', getCalendarSlots);

router.get('/schedules', getSchedules);
router.get('/doctors/available', getAvailableDoctors);

router.get('/doctors/search', searchDoctors);
router.get('/treatments', getTreatments);

// Root welcome route
router.get('/', (req, res) => res.send('Bienvenido'));

router.post('/add', addAppointment);
router.delete('/delete/:id', deleteAppointment);
router.post('/cancel', cancelByPhone);

router.post('/log', addLog);

// Health under WP-JSON prefix
router.get('/health', (req, res) => res.json({ status: 'ok' }));

export default router;
