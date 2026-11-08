import datetime
import math
import uuid

from flask import flash, redirect, request, url_for

from routing import main
from storage import load_data, save_data


@main.route('/save_nutrition', methods=['POST'])
def save_nutrition():
    data = load_data()
    try:
        entry_date = request.form.get('date', '').strip()
        datetime.date.fromisoformat(entry_date)
        values = {}
        for field in ('calories', 'protein', 'carbs', 'fat', 'water'):
            raw = request.form.get(field, '').strip()
            if raw:
                number = float(raw)
                if not math.isfinite(number) or number < 0:
                    raise ValueError
                values[field] = round(number, 2)
        notes = request.form.get('notes', '').strip()[:500]
        if not values:
            raise ValueError
    except (ValueError, TypeError):
        flash('Enter a valid date and at least one nutrition value.', 'error')
        return redirect(url_for('main.index', tab='nutrition'))
    data['nutrition'].append({'id': str(uuid.uuid4()), 'date': entry_date, **values, 'notes': notes, 'profile_id': request.form.get('profile_id', 'default').strip() or 'default'})
    save_data(data)
    flash('Nutrition entry saved.', 'success')
    return redirect(url_for('main.index', tab='nutrition'))


@main.route('/delete_nutrition/<entry_id>', methods=['POST'])
def delete_nutrition(entry_id):
    data = load_data()
    before = len(data['nutrition'])
    data['nutrition'] = [item for item in data['nutrition'] if item.get('id') != entry_id]
    if len(data['nutrition']) == before:
        flash('Nutrition entry could not be found.', 'error')
    else:
        save_data(data)
        flash('Nutrition entry deleted.', 'success')
    return redirect(url_for('main.index', tab='nutrition'))
