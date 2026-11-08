import io
from flask import send_file, url_for

from routing import main
from storage import load_data


@main.route('/export/session/<session_id>.pdf')
def export_session_pdf(session_id):
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    except ImportError:
        return 'PDF export requires the reportlab dependency. Install the project requirements and try again.', 503
    data = load_data()
    workouts = [item for item in data['workouts'] if item.get('session_id') == session_id]
    if not workouts:
        return 'Workout session not found', 404
    first = workouts[0]
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, rightMargin=0.55 * inch, leftMargin=0.55 * inch, topMargin=0.5 * inch, bottomMargin=0.5 * inch)
    styles = getSampleStyleSheet()
    story = [Paragraph('IronTrack Workout Report', styles['Title']), Paragraph(f"{first.get('session_name', 'Workout')} · {first.get('date', '')}", styles['Heading2']), Spacer(1, 12)]
    rows = [['Exercise', 'Type', 'Load', 'Reps', 'RPE', 'Notes']]
    for item in workouts:
        load = 'Bodyweight' if item.get('bodyweight') else f"{item.get('weight', 0)} {item.get('unit', 'kg')}"
        rows.append([item.get('exercise', ''), item.get('set_type', 'working'), load, str(item.get('reps', '')), str(item.get('rpe', '')), item.get('notes', '')])
    table = Table(rows, repeatRows=1, colWidths=[1.45 * inch, 0.7 * inch, 0.8 * inch, 0.45 * inch, 0.4 * inch, 2.35 * inch])
    table.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#047857')), ('TEXTCOLOR', (0, 0), (-1, 0), colors.white), ('GRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#cbd5e1')), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('FONTSIZE', (0, 0), (-1, -1), 8), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f1f5f9')])]))
    story.append(table)
    nutrition = [item for item in data.get('nutrition', []) if item.get('date') == first.get('date')]
    if nutrition:
        item = nutrition[-1]
        story += [Spacer(1, 16), Paragraph('Nutrition logged that day', styles['Heading3']), Paragraph(' · '.join(f"{key.title()}: {item[key]}" for key in ('calories', 'protein', 'carbs', 'fat', 'water') if key in item), styles['BodyText'])]
    document.build(story)
    output.seek(0)
    return send_file(output, as_attachment=True, download_name=f"irontrack_{first.get('date', 'workout')}.pdf", mimetype='application/pdf')
